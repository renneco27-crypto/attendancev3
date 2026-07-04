import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision"

const DEFAULT_CONFIG = {
  windowSize: 20,
  nodThresholdDeg: 10,
  turnThresholdDeg: 14,
  minReversalDeg: 1
};

export class LivenessChecker {
  video: HTMLVideoElement
  onGesture: (result: { gesture: string; pitch: number; yaw: number; pitchRange: number; yawRange: number }) => void
  onNoFace: () => void
  onError: (err: Error) => void
  config: typeof DEFAULT_CONFIG
  faceLandmarker: any = null
  stream: MediaStream | null = null
  running = false
  lastVideoTime = -1
  pitchHistory: number[] = []
  yawHistory: number[] = []

  constructor({ videoElement, onGesture, onNoFace = () => {}, onError = () => {}, config = {} }: {
    videoElement: HTMLVideoElement
    onGesture: (result: { gesture: string; pitch: number; yaw: number; pitchRange: number; yawRange: number }) => void
    onNoFace?: () => void
    onError?: (err: Error) => void
    config?: Partial<typeof DEFAULT_CONFIG>
  }) {
    this.video = videoElement;
    this.onGesture = onGesture;
    this.onNoFace = onNoFace;
    this.onError = onError;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start() {
    try {
      if (!this.faceLandmarker) {
        await this._loadModel();
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.running = true;
      this.pitchHistory = [];
      this.yawHistory = [];
      this._loop();
    } catch (err) {
      this.onError(err as Error);
      throw err;
    }
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  reset() {
    this.pitchHistory = [];
    this.yawHistory = [];
  }

  async _loadModel() {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
    );
    this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1
    });
  }

  _loop = () => {
    if (!this.running) return;
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const results = this.faceLandmarker.detectForVideo(this.video, performance.now());
      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        let pitch = 0, yaw = 0;
        if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
          const euler = this._matrixToEuler(results.facialTransformationMatrixes[0].data);
          pitch = euler.pitch;
          yaw = euler.yaw;
        }
        this._pushBounded(this.pitchHistory, pitch);
        this._pushBounded(this.yawHistory, yaw);
        const pitchRange = this._range(this.pitchHistory);
        const yawRange = this._range(this.yawHistory);
        let gesture = 'none';
        if (this.pitchHistory.length >= 6 && pitchRange > this.config.nodThresholdDeg && this._hasReversal(this.pitchHistory)) {
          gesture = 'nod';
        } else if (this.yawHistory.length >= 6 && yawRange > this.config.turnThresholdDeg) {
          gesture = yaw > 0 ? 'turn_left' : 'turn_right';
        }
        this.onGesture({ gesture, pitch, yaw, pitchRange, yawRange });
      } else {
        this.onNoFace();
      }
    }
    requestAnimationFrame(this._loop);
  }

  _pushBounded(arr: number[], value: number) {
    arr.push(value);
    if (arr.length > this.config.windowSize) arr.shift();
  }

  _range(arr: number[]) {
    if (arr.length === 0) return 0;
    return Math.max(...arr) - Math.min(...arr);
  }

  _hasReversal(values: number[]) {
    if (values.length < 6) return false;
    const mid = Math.floor(values.length / 2);
    const firstTrend = values[mid] - values[0];
    const secondTrend = values[values.length - 1] - values[mid];
    return firstTrend * secondTrend < 0 &&
      Math.abs(firstTrend) > this.config.minReversalDeg &&
      Math.abs(secondTrend) > this.config.minReversalDeg;
  }

  _matrixToEuler(m: number[]) {
    const r00 = m[0], r10 = m[1], r20 = m[2];
    const r12 = m[9], r21 = m[6], r22 = m[10], r11 = m[5];
    const sy = Math.sqrt(r00 * r00 + r10 * r10);
    const singular = sy < 1e-6;
    let x, y;
    if (!singular) {
      x = Math.atan2(r21, r22);
      y = Math.atan2(-r20, sy);
    } else {
      x = Math.atan2(-r12, r11);
      y = Math.atan2(-r20, sy);
    }
    return {
      pitch: x * 180 / Math.PI,
      yaw: y * 180 / Math.PI
    };
  }
}
