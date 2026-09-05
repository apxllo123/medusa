export interface MacScreenTextObservation {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MacScreenObservationResult {
  captured: boolean;
  source: "window" | "display" | "none";
  windowId: number | null;
  windowTitle: string | null;
  imagePath: string | null;
  observations: MacScreenTextObservation[];
  combinedText: string;
  error: string | null;
}

/**
 * Native implementation boundary for macOS screen observation. The
 * implementation can use ScreenCaptureKit for a scoped game/error window
 * and Vision for on-device OCR. Keeping the boundary here lets the
 * diagnostic pipeline remain platform-agnostic and testable on CI.
 */
export interface MacScreenObserver {
  captureWindow(windowId?: number): Promise<MacScreenObservationResult>;
  captureFocusedGameWindow(): Promise<MacScreenObservationResult>;
}
