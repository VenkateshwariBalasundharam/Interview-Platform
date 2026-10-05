// Browser-only camera and face-detection helpers. Import from client components only.
// The models are served from /public/models (copied from @vladmandic/face-api), so no face data or model download
// goes through a third party. The pure rules live in lib/face-client-core.ts.
import {
  SNAPSHOT_TARGET_BYTES,
  buildReading,
  nextSnapshotStep,
  snapshotStep,
  type FaceReading,
} from '@/lib/face-client-core';

type FaceApi = typeof import('@vladmandic/face-api');

const MODEL_URL = '/models';
let apiPromise: Promise<FaceApi> | null = null;
let recognitionLoaded = false;

/** Loads the library and the detector once. The (larger) recognition model is loaded only when identity checks need it. */
export async function loadFaceApi(withRecognition: boolean): Promise<FaceApi> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      // The bundled TensorFlow has ready(), but the library's type declarations do not list it.
      await (faceapi.tf as unknown as { ready?: () => Promise<void> }).ready?.();
      await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL), faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)]);
      return faceapi;
    })();
    apiPromise.catch(() => {
      apiPromise = null; // allow a retry after a network failure
    });
  }
  const faceapi = await apiPromise;
  if (withRecognition && !recognitionLoaded) {
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    recognitionLoaded = true;
  }
  return faceapi;
}

export type CameraErrorKind = 'denied' | 'no_camera' | 'in_use' | 'unsupported' | 'other';

export function cameraErrorKind(e: unknown): CameraErrorKind {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'no_camera';
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'in_use';
  if (name === 'TypeError') return 'unsupported';
  return 'other';
}

export const CAMERA_ERROR_TEXT: Record<CameraErrorKind, string> = {
  denied: 'The camera is blocked. Click the camera or lock icon in the address bar, allow the camera for this site, then try again.',
  no_camera: 'No camera was found. Connect a webcam, or use a computer that has one, then try again.',
  in_use: 'The camera is being used by another app or tab. Close it, then try again.',
  unsupported: 'This browser cannot use the camera here. Use a recent Chrome, Edge, Firefox or Safari on a computer.',
  other: 'The camera could not be started. Check it is connected and allowed, then try again.',
};

export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new TypeError('getUserMedia is not available');
  return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** A video element is ready to read when it has frames of a real size. */
export function videoReady(video: HTMLVideoElement | null): video is HTMLVideoElement {
  return !!video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

export interface Frame {
  reading: FaceReading;
  /** The same frame, kept so a photo can be attached if the server asks for one. */
  canvas: HTMLCanvasElement | null;
}

/** One look at the camera: how many faces, head turn, and (for identity checks) the face descriptor. */
export async function readFrame(video: HTMLVideoElement, withDescriptor: boolean): Promise<Frame> {
  const faceapi = await loadFaceApi(withDescriptor);
  const startedAt = Date.now();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const found = withDescriptor
    ? await faceapi.detectAllFaces(video, options).withFaceLandmarks().withFaceDescriptors()
    : await faceapi.detectAllFaces(video, options).withFaceLandmarks();
  const canvas = copyFrame(video);
  const only = found.length === 1 ? found[0] : null;
  const reading = buildReading(
    {
      faces: found.length,
      landmarks: only?.landmarks.positions,
      descriptor: only && 'descriptor' in only ? (only.descriptor as Float32Array) : undefined,
    },
    withDescriptor,
    Date.now() - startedAt,
  );
  return { reading, canvas };
}

function copyFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch {
    return null;
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** A JPEG of the frame, shrunk until it fits the server's limit. null if it cannot be made small enough. */
export async function frameToJpeg(source: HTMLCanvasElement): Promise<Blob | null> {
  let step = 0;
  for (;;) {
    const { width, quality } = snapshotStep(step);
    const scale = Math.min(1, width / source.width);
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(source.width * scale));
    target.height = Math.max(1, Math.round(source.height * scale));
    target.getContext('2d')?.drawImage(source, 0, 0, target.width, target.height);
    const blob = await toBlob(target, quality);
    if (!blob) return null;
    if (blob.size <= SNAPSHOT_TARGET_BYTES) return blob;
    const next = nextSnapshotStep(step, blob.size);
    if (next === null) return null;
    step = next;
  }
}
