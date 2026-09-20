# Educational Autonomous Tracker

This repository is a production-oriented proof of concept for camera tracking, state
estimation, pan and tilt control, and simulated projectile interception. It runs end to end
without hardware, then supports a real camera and a harmless motorized pan and tilt testbed.

## Rescue annotation desktop

Double-click `Rescue Studio.exe` in this folder for the separate, observation-only footage library.
Choose a clip and **Continue labeling** to resume saved boxes at your last saved frame. Training
and prediction import are separate actions. To improve an existing model, choose it in
**04 Train model > My models**, click **Analyze entire video and correct boxes**, correct and
review the predictions, then **Save and train updated model**. Files are managed automatically.
Type a box tag and press Enter, or use the tag buttons.
Keep the executable next to this project and its `.venv` folder. See
[the desktop guide](docs/RESCUE_LABEL_STUDIO.md) for the no-command workflow and training requirements.

## Non-negotiable safety boundary

Real hardware can move pan and tilt axes, read encoders and limit switches, track fiducial or
color targets, show a hypothetical intercept, and record a simulated shot. It cannot launch,
release, propel, or trigger a projectile.

- `SimulatedLauncher` has no GPIO, serial, relay, solenoid, valve, or physical callback.
- The serial `MessageType` enum has motor, safety, heartbeat, and telemetry messages only.
- The firmware exposes no firing or trigger pin and parses no firing command.
- Burst and adaptive cadence exist only as software event generation.
- `tests/test_protocol.py` locks the no-projectile-command protocol invariant.

This separation is deliberate. Do not add a physical launcher backend to this project.

## Architecture

The tracking and pointing path is:

```text
Camera
  |
Detector
  |
3D Pose / Range
  |
Multi-Target Tracker
  |
State Estimator
  |
Target Selector
  |
Latency Compensation / Trajectory Predictor
  |
Simulated Ballistic Solver
  |
Aim Solver
  |
PID / Velocity Feedforward
  |
Motion Constraints / Backlash / Deadband
  |
Pan/Tilt HAL
```

The projectile path is separate and remains entirely in memory:

```text
Simulated Ballistic Solver
  |
Central Permission Function
  |
SimulatedLauncher
  |
Projectile Simulator
  |
Impact Evaluation / Metrics / JSONL Event
```

Coordinate frames are right-handed. In the platform frame, x points forward, y points left,
and z points up. Azimuth is positive from x toward y. Elevation is positive above the x-y
plane. SI units are used internally.

## Implemented components

- Strict Pydantic configuration with unknown-field rejection and commented YAML examples.
- OpenCV USB and video-file cameras plus a deterministic simulated camera.
- Color-blob and ArUco detectors plus an optional Ultralytics YOLO26 backend. YOLO detections
  retain class labels, support class ID/name filtering, and use configurable class dimensions
  for calibrated monocular 3D ranging.
- Checkerboard intrinsic calibration and Kabsch rigid extrinsic calibration.
- Hungarian-gated multi-target association with persistent IDs.
- Nine-state position, velocity, and acceleration Kalman estimation.
- Constant-position, constant-velocity, and constant-acceleration prediction.
- RK4 projectile integration with gravity, wind, quadratic drag, a Mach-dependent drag curve,
  optional aerodynamic lift, and continuous swept collision checks.
- Bounded moving-target numerical intercept optimization and a marked fallback solver.
- Independent pan and tilt PID loops with filtered derivative, output and integral limits,
  conditional-integration anti-windup, bumpless restart, and velocity feedforward.
- Position, velocity, acceleration, and optional jerk constraints.
- Direction-aware backlash compensation and servo deadband modeling.
- Robotics-only target scoring with selection hysteresis.
- Weighted alignment confidence and centralized detailed simulated-shot permissions.
- Deterministic state machine, watchdogs, software E-stop, and physical E-stop firmware input.
- Simulated single, burst, and adaptive-cadence support with per-shot revalidation.
- JSONL logs, deterministic replay, optional FastAPI WebSocket telemetry, and OpenCV overlay.
- Versioned calibration database, latency diagnostics, motor fitting, and safe synthetic
  projectile-parameter experiments.

## 200 km/h lateral interception benchmark

The high-speed profile is software-only and models a target traveling laterally at 200 km/h,
which is 55.56 m/s. Run it with:

```bash
python tools/run_high_speed_validation.py \
  --config configs/high_speed_200kmh.yaml \
  --distances 20 50 100 \
  --output validation/high_speed_200kmh.json
```

Show the animated camera and top-down physics view for one range:

```powershell
python tools\run_high_speed_validation.py --distances 50 --show
```

Write a slow-motion MP4 that can be replayed after the run:

```powershell
python tools\run_high_speed_validation.py `
  --distances 50 `
  --video-dir diagnostics\high-speed `
  --playback-fps 60
```

The MP4 contains the rendered camera feed and detections on the left. The right side shows
ground-truth and estimated target positions, the mount aim ray, predicted trajectory,
interception point, and time-resolved virtual projectile markers.

The benchmark does not mark a hit from the solver's own predicted miss. At every authorized
event it launches a separate virtual projectile from the simulated mount's actual angle,
integrates it at a finer timestep, samples exact target truth independently, and performs a
continuous closest-approach collision test. This catches estimator, solver-update, alignment,
and actuator-following errors.

The committed deterministic validation result is:

| Lateral range | Peak line-of-sight rate | Tracking RMS | Post-alignment prediction RMS | Actual virtual-impact RMS | Post-alignment pan RMS | Acquisition | Propagated hits |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 m | 159.15 deg/s | 0.070 m | 0.195 m | 0.184 m | 0.636 deg | 0.228 s | 2/2 |
| 50 m | 63.66 deg/s | 0.046 m | 0.186 m | 0.173 m | 0.233 deg | 0.323 s | 8/8 |
| 100 m | 31.83 deg/s | 0.034 m | 0.173 m | 0.182 m | 0.144 deg | 0.439 s | 17/17 |

The profile uses a 480 FPS synthetic camera, 0.5 ms exposure, noisy capture timestamps,
5 ms camera latency with jitter, measurement noise, frame loss, temporary occlusion, a
120 Hz numerical solver, and a 960 Hz acceleration-and-jerk-limited pan/tilt model. The
virtual projectile is 20 g and 12.7 mm at 300 m/s, with gravity, air density, crosswind, and
a transonic drag curve. The range-aware permission cone reserves half the target radius for
prediction error instead of treating the configured 1 degree value as safe at every range.

These results establish repeatable simulation performance for the exact configuration and
seed. They are not a real-world accuracy guarantee. Real deployment would require measured
camera blur and latency, calibrated 3D range, motor bandwidth, structural vibration, wind,
and identified aerodynamic parameters. The hardware backend remains pan/tilt-only and has no
physical projectile command.

## Setup

Python 3.12 or newer is required.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e ".[dev]"
pytest
```

On Windows:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
pytest
```

The standard installation uses GUI-capable `opencv-python`, which is required for `--show`.
If an older environment contains `opencv-python-headless`, repair it with:

```powershell
python -m pip uninstall -y opencv-python-headless
python -m pip install --force-reinstall opencv-python
python -m pip install -e ".[dev]"
```

The MP4 options remain usable on deliberately headless machines.

Optional extras are `.[hardware]`, `.[yolo]`, `.[telemetry]`, and `.[diagnostics]`.

## Run simulation

```bash
python -m tracker.cli.simulate --config configs/simulation.yaml
```

Add `--show` for an animated window or `--video diagnostics/simulation.mp4` to record it.

Override a scenario or duration:

```bash
python -m tracker.cli.simulate \
  --config configs/simulation.yaml \
  --scenario constant_velocity \
  --duration 5
```

Run the four primary validation scenarios:

```bash
python tools/run_validation_scenarios.py \
  --config configs/simulation.yaml \
  --duration 4 \
  --output validation/scenarios.json
```

Each run prints tracking RMS error, velocity RMS error, prediction RMS error, solver success,
solver miss distance, independently propagated truth-impact distance, pan and tilt error,
alignment time, simulated hit rate, track loss, and state-machine fault count.

Synthetic trajectories include stationary, constant velocity, acceleration, circular,
sinusoidal, and deterministic random waypoint motion. The camera can add noise, latency,
dropped frames, and occlusion. The actuator obeys real configured limits.

## Run a harmless hardware tracker

Install the serial extra and edit the serial port, camera calibration path, and mechanical
limits before connecting hardware:

```bash
pip install -e ".[hardware]"
python -m tracker.cli.run_hardware --config configs/hardware.yaml
```

Record the live debug overlay to a video without adding a GUI dependency:

```bash
python -m tracker.cli.run_hardware \
  --config configs/hardware.yaml \
  --debug-video diagnostics/hardware-overlay.mp4
```

The hardware loop reads a camera, estimates target state, solves a hypothetical intercept,
and commands pan and tilt motion. It advances through `TRACKING`, `ALIGNED`, `READY`,
`SIMULATED_FIRING`, and `COOLDOWN`, but `SIMULATED_FIRING` only writes an immutable software
record. It never sends projectile information to the microcontroller. Press Ctrl+C to stop.
The `finally` path sends `STOP` before resources close.

The firmware is at `firmware/pan_tilt_controller/pan_tilt_controller.ino`. Review pin numbers,
servo mapping, limit polarity, safe limits, and home pose before flashing. On heartbeat loss
or physical E-stop assertion it detaches both servo outputs and enters a safe stationary
state. E-stop reset is explicit and never starts motion.

## Run YOLO object tracking

For calibration-free rescue observation, recorded-video review, tracking history and reports,
use the separate [rescue review workflow](docs/RESCUE_REVIEW.md). Its
[source guide](docs/RESCUE_SOURCES.md) records dataset and sample-video provenance.

The [real-data starter guide](docs/RESCUE_DATASET_STARTER.md) covers the additional fire videos,
flood image/mask samples, label-quality findings and broader disaster-data candidates.

For editable recognition boxes, custom rescue labels, evaluation and guided YOLO training, see
[Rescue Label Studio](docs/RESCUE_LABEL_STUDIO.md):

```powershell
python -m tracker.cli.rescue_annotate
```
Choose the original video and annotation project in the file pickers. Import a saved recognition
run, correct its draft boxes, then use **Train model > Train using these labels** for a practice run.
Studio handles data preparation automatically and adds completed versions to **My models**.
Select a model by name to preview it, rename it or train an updated version; no model-file
picker is needed for saved versions. Separate recordings are needed later to assess
reliability; practice results are marked not independently tested. Saving labels alone does not
train the model. It does not connect
observations to motor or projectile control.

For repeatable scoring across videos with split-overlap checks and per-incident metrics, see
the [multi-incident rescue benchmark](docs/RESCUE_BENCHMARK.md). A runnable synthetic workflow demo
is available with `python tools\create_rescue_benchmark_demo.py`; its generated scores are not
measurements of YOLO or real rescue accuracy.

Install the YOLO extra:

```powershell
python -m pip install -e ".[dev,yolo]"
```

Calibrate the camera before using monocular 3D ranging, then run the safe camera profile:

```powershell
python -m tracker.cli.calibrate camera `
  --device 0 `
  --checkerboard 9x6 `
  --square-size 0.024 `
  --frames 20 `
  --output calibrations\camera.json `
  --show

python -m tracker.cli.run_hardware `
  --config configs\yolo_camera.yaml `
  --show
```

`configs/yolo_camera.yaml` uses a real camera but keeps pan/tilt simulated. Its default
`yolo26n.pt` weights are obtained by Ultralytics on first use. A local custom `.pt` model can
be selected with `target.yolo_model`. Restrict detections with `yolo_class_ids` or
`yolo_class_names`; the example tracks only `sports ball`.

Each selected class needs a realistic physical width in `class_dimensions_m`. YOLO itself
provides a 2D box, not metric depth. With camera intrinsics and an assumed class width, the
system calculates a 3D measurement and covariance, associates class-consistent persistent
tracks, estimates velocity and acceleration, compensates actual inference latency, predicts
motion through virtual projectile flight time, solves gravity/drag/wind interception, and
controls pan/tilt. Live frames can be recorded with `--debug-video`.

All projectile calculations and shot records remain simulated. The host serial protocol and
firmware contain no launch, release, fire, relay, or trigger message.

For calibration, use a printed 9 by 6 internal-corner checkerboard with accurately measured
24 mm squares, or change `--square-size` to the measured size in metres. In the live window,
move and tilt the board so it covers different parts of the image, then press Space for each
view. Do not capture 20 copies of the same stationary pose.

## Calibration

Camera checkerboard intrinsics:

```bash
python -m tracker.cli.calibrate camera \
  --device 0 \
  --checkerboard 9x6 \
  --square-size 0.024 \
  --frames 20 \
  --output calibrations/camera.json
```

Motor calibration first prints points strictly inside configured limits. Move and measure
only under direct supervision. It does not automatically sweep hardware.

```bash
python -m tracker.cli.calibrate motors --minimum -1.0 --maximum 1.0
python -m tracker.cli.calibrate motors samples.csv \
  --minimum -1.0 --maximum 1.0
```

CSV columns are `timestamp_s,commanded_rad,measured_rad`. Fitting estimates zero, direction,
scale, response delay, deadband, backlash, and velocity gain.

Latency and safe synthetic projectile calibration:

```bash
python -m tracker.cli.calibrate latency
python -m tracker.cli.calibrate simulated-projectile
```

Extrinsics use a CSV with `source_x,source_y,source_z,destination_x,destination_y,destination_z`:

```bash
python -m tracker.cli.calibrate extrinsic matched-points.csv
```

The calibration database stores kind, version, UTC timestamp, method, uncertainty, values,
and notes. Synthetic projectile calibration produces noisy software trajectories and fits
muzzle speed, drag coefficient, and wind. It performs no physical experiment.

## Serial protocol

Frames are little-endian and contain:

```text
magic[2] | version[1] | type[1] | sequence[2] | payload_length[2] | payload | CRC16[2]
```

Payloads are bounded at 128 bytes. The parser resynchronizes on magic and rejects bad version,
length, type, and CRC. Host commands are `SET_ANGLES`, `SET_VELOCITY`, `STOP`, `HOME`, `PING`,
`EMERGENCY_STOP`, and `RESET_EMERGENCY_STOP`. Firmware responses are `STATE`, `LIMITS`, `FAULT`,
and `PONG`. There is no firing command.

## State machine and permissions

The deterministic states are `IDLE`, `CALIBRATING`, `TRACKING`, `ALIGNED`, `READY`,
`SIMULATED_FIRING`, `COOLDOWN`, `FAULT`, and `SUPERVISED_TEST`. Every transition is logged.
Any state can enter `FAULT`; leaving `FAULT` requires explicit reset.

`can_simulate_fire()` is the single permission authority. It requires `READY`, tracking and
alignment confidence, angular tolerance, stable platform motion, a valid simulated solution,
fresh target state, complete cooldown, and healthy watchdog state. Rejections contain every
failed reason rather than one opaque boolean.

Burst mode rechecks the context and solution before each software event. Adaptive cadence
shortens the interval slightly for higher target angular velocity, but lengthens it for lower
estimator confidence, larger predicted miss, or platform instability. All outputs are clamped
between configured minimum and maximum intervals.

## PID tuning

Tune on the harmless rig at reduced mechanical limits:

1. Disable integral and derivative gains.
2. Increase proportional gain until response is firm but not oscillatory.
3. Add derivative gain to reduce overshoot and observe noise sensitivity.
4. Add only enough integral gain to remove steady-state bias.
5. Verify output and mechanical saturation in both directions.
6. Hold a saturated command and verify anti-windup recovery on reversal.
7. Test direction reversals to validate backlash compensation.
8. Test maximum velocity, acceleration, and jerk constraints.
9. Enable velocity feedforward and compare following error.
10. Repeat with noisy tracking, drops, and worst-case configured latency.

Latency consumes phase margin. Higher camera, estimation, serial, or motor delay requires lower
closed-loop bandwidth and usually less proportional and derivative gain. Internal `dt` uses
monotonic time. Wall-clock timestamps are reserved for human-readable logs. Prediction uses:

```text
effective_prediction_time = estimated_system_latency + simulated_flight_time
```

## Concurrency and performance

The hardware path keeps camera acquisition, vision, tracking, control, serial, telemetry, and
logging ownership separate. `DropOldestQueue` is the boundary primitive for asynchronous
deployments. Its queues are bounded and discard the oldest camera data, so a slow detector
reduces frame rate instead of accumulating control latency.

Recommended rates are camera 30 Hz, vision and tracking 20 to 30 Hz, control 50 to 100 Hz,
and telemetry 10 to 20 Hz. Telemetry is optional and receives copies through latest-only
queues; core control never waits on a socket.

## Logging, replay, and overlay

JSONL events include schema version, session, sequence, monotonic timestamp, UTC wall timestamp,
event type, and a JSON-safe payload. Record payloads can contain detections, tracks, selected
target, estimates, solution, motor command and state, system state, simulated shots, faults,
and latency metrics.

```bash
python tools/replay_session.py logs/session.jsonl
python tools/plot_logs.py logs/session.jsonl
```

Replay rejects sequence gaps and non-monotonic input. Application-specific processors can feed
recorded camera measurements through the same estimator, selector, solver, and state machine.
The debug overlay shows boxes, confidence, track count and selection, current and desired pan
and tilt, alignment, solver method, flight time, miss estimate, state, FPS, and latency.

## Verification

```bash
ruff check .
ruff format --check .
mypy src/tracker
pytest
```

Tests use deterministic seeds and cover filters, acceleration, transforms, gravity, drag,
wind, intercepts, fallback, PID saturation and windup, backlash, hysteresis, alignment,
state transitions, cooldown, watchdog faulting, protocol framing, replay, queues, overlays,
and end-to-end simulation.

## Practical limits

Monocular known-size ranging has larger depth uncertainty than stereo or depth sensing. ArUco
pose depends on accurate intrinsics and marker size. The default Kalman and drag models are
educational approximations, not a system-identification substitute. Validate camera extrinsics,
motor direction, limit switches, E-stop polarity, watchdog behavior, and safe angular bounds on
your exact harmless pan and tilt rig before enabling motion.
