"""
remoteMotors.py — runs on the robot's Windows computer.

Listens to /robots/{ROBOT_ID}/state/motors in the FLEXI Firebase database
(written by robotapijs: setMotor / setMotors / setPose / moveNeck) and sends
each motor's value to the Dynamixel motors as a goal position.

Optionally also reads the head touch sensor (an Arduino on a second COM port
that prints "Pressed") and writes state/headTouched back to the database.

Setup (once):
    pip install requests pyserial dynamixel-sdk

Run:
    python remoteMotors.py
"""

import time

import requests
from dynamixel_sdk import PortHandler, PacketHandler, COMM_SUCCESS

# ── Configuration — edit these for your robot ──────────────────────────────

# Robot index in the database. Must match the robot selected on the website
# (the number after "?robot=" / "robotId=" in the page URL).
ROBOT_ID = 0

# COM port of the Dynamixel USB adapter (check Windows Device Manager →
# "Ports (COM & LPT)").
MOTOR_PORT = "COM4"
BAUDRATE = 57600
PROTOCOL_VERSION = 2.0

# COM port of the head touch sensor Arduino, or None if there is none.
TOUCH_PORT = None  # e.g. "COM3"

# Motor name on the website → Dynamixel ID (same mapping as the original
# EMAR-Motor-Control remoteMotors.py).
MOTOR_IDS = {
    "Left/Right Tilt": 4,
    "Up/Down Tilt": 3,
    "Neck": 2,
    "Rotate": 1,
}

# Goal PWM per motor ID (limits speed/force), from the original script.
GOAL_PWM = {1: 375, 2: 375, 3: 375, 4: 100}

POLL_INTERVAL = 0.2  # seconds between database checks

# Firebase project used by the website (see robotsetting/scripts/config.js).
DB_URL = "https://flexi-f7d77-default-rtdb.firebaseio.com/"
API_KEY = "AIzaSyB10dHhQqD1TMXTJfQNLmFkrJtVyQ4JTuA"

# Dynamixel X-series control table addresses
ADDR_OPERATING_MODE = 11
ADDR_TORQUE_ENABLE = 64
ADDR_GOAL_PWM = 100
ADDR_GOAL_POSITION = 116
POSITION_MODE = 3


# ── Dynamixel ──────────────────────────────────────────────────────────────

def check(result, error, packet, what):
    if result != COMM_SUCCESS:
        print("  [motor] %s failed: %s" % (what, packet.getTxRxResult(result)))
        return False
    if error != 0:
        print("  [motor] %s error: %s" % (what, packet.getRxPacketError(error)))
        return False
    return True


def init_motors():
    port = PortHandler(MOTOR_PORT)
    packet = PacketHandler(PROTOCOL_VERSION)
    if not port.openPort():
        raise SystemExit("Could not open %s. Is the Dynamixel adapter plugged in, "
                         "and is MOTOR_PORT correct?" % MOTOR_PORT)
    if not port.setBaudRate(BAUDRATE):
        raise SystemExit("Could not set baudrate %d on %s." % (BAUDRATE, MOTOR_PORT))
    print("Opened %s" % MOTOR_PORT)

    for motor_id in MOTOR_IDS.values():
        # Operating mode can only be changed while torque is off.
        packet.write1ByteTxRx(port, motor_id, ADDR_TORQUE_ENABLE, 0)
        packet.write1ByteTxRx(port, motor_id, ADDR_OPERATING_MODE, POSITION_MODE)
        packet.write2ByteTxRx(port, motor_id, ADDR_GOAL_PWM, GOAL_PWM.get(motor_id, 375))
        result, error = packet.write1ByteTxRx(port, motor_id, ADDR_TORQUE_ENABLE, 1)
        if check(result, error, packet, "torque on ID %d" % motor_id):
            print("Motor ID %d connected" % motor_id)
    return port, packet


def move_motor(port, packet, motor_id, position):
    result, error = packet.write4ByteTxRx(port, motor_id, ADDR_GOAL_POSITION, position)
    check(result, error, packet, "move ID %d" % motor_id)




# ── Firebase ───────────────────────────────────────────────────────────────

def read_motors(session):
    """Return the motor list from the database, or None if unavailable."""
    url = DB_URL + "robots/%d/state/motors.json" % ROBOT_ID
    data = session.get(url, timeout=5).json()
    if isinstance(data, dict) and "error" in data:
        print("  [db] Read error: %s" % data["error"])
        return None
    if isinstance(data, dict):  # Firebase may return a list as {"0": ..., "1": ...}
        data = [data[k] for k in sorted(data, key=int)]
    return data


class TouchSensor:
    """Reads the touch Arduino without blocking and reports to the database.

    Writing needs a signed-in user, so this signs in anonymously (Anonymous
    sign-in must be enabled in the Firebase console) and refreshes the token
    before it expires.
    """

    def __init__(self, session):
        import serial
        self.session = session
        self.serial = serial.Serial(TOUCH_PORT, 9600, timeout=0)
        self.buffer = b""
        self.pressed = False
        self.token = None
        self.refresh_token = None
        self.token_expires = 0
        self._sign_in()

    def _sign_in(self):
        url = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + API_KEY
        data = self.session.post(url, json={"returnSecureToken": True}, timeout=10).json()
        if "idToken" not in data:
            print("  [touch] Anonymous sign-in failed (%s). Touch sensor will not be "
                  "reported." % data.get("error", {}).get("message"))
            return
        self._store_token(data["idToken"], data["refreshToken"], data["expiresIn"])

    def _store_token(self, token, refresh_token, expires_in):
        self.token = token
        self.refresh_token = refresh_token
        self.token_expires = time.time() + int(expires_in) - 300

    def _auth(self):
        if self.refresh_token and time.time() > self.token_expires:
            url = "https://securetoken.googleapis.com/v1/token?key=" + API_KEY
            data = self.session.post(url, data={"grant_type": "refresh_token",
                                                "refresh_token": self.refresh_token},
                                     timeout=10).json()
            if "id_token" in data:
                self._store_token(data["id_token"], data["refresh_token"], data["expires_in"])
        return self.token

    def poll(self):
        self.buffer += self.serial.read(self.serial.in_waiting or 0)
        lines = self.buffer.split(b"\n")
        self.buffer = lines.pop()
        if not lines:
            return
        pressed = lines[-1].strip() == b"Pressed"
        if pressed != self.pressed:
            self.pressed = pressed
            print("Head touched" if pressed else "Head released")
            token = self._auth()
            if token:
                url = DB_URL + "robots/%d/state.json" % ROBOT_ID
                self.session.patch(url, params={"auth": token},
                                   json={"headTouched": 1 if pressed else 0}, timeout=5)


# ── Main loop ──────────────────────────────────────────────────────────────

def main():
    session = requests.Session()
    port, packet = init_motors()
    touch = TouchSensor(session) if TOUCH_PORT else None

    last_positions = {}
    print("Listening to robot %d. Press Ctrl+C to stop." % ROBOT_ID)
    try:
        while True:
            try:
                motors = read_motors(session)
            except requests.RequestException as e:
                print("  [db] Network error: %s" % e)
                motors = None

            if motors is None:
                print("  [db] No motor data for robot %d — check ROBOT_ID and that "
                      "'Enable Robot Movement' was clicked in Robot Setup." % ROBOT_ID)
                time.sleep(2)
            else:
                for motor in motors:
                    if not motor or motor.get("name") not in MOTOR_IDS:
                        continue
                    value = int(motor.get("value", 0))
                    value = max(int(motor.get("min", value)), min(int(motor.get("max", value)), value))
                    motor_id = MOTOR_IDS[motor["name"]]
                    if last_positions.get(motor_id) != value:
                        print("%s (ID %d) -> %d" % (motor["name"], motor_id, value))
                        move_motor(port, packet, motor_id, value)
                        last_positions[motor_id] = value

            if touch:
                try:
                    touch.poll()
                except requests.RequestException as e:
                    print("  [touch] Network error: %s" % e)

            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        # Torque stays on so the head doesn't drop when the script stops.
        print("Stopping.")
    finally:
        port.closePort()


if __name__ == "__main__":
    main()
