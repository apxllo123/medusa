import Foundation
import AppKit
import ScreenCaptureKit
import Vision

struct TextObservation: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct ObservationResult: Codable {
    let captured: Bool
    let source: String
    let windowId: UInt32?
    let imagePath: String?
    let observations: [TextObservation]
    let combinedText: String
    let error: String?
}

@available(macOS 14.0, *)
final class Observer {
    func run(windowID: UInt32?) async -> ObservationResult {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                true,
                onScreenWindowsOnly: true
            )
            guard let window = resolveWindow(content: content, windowID: windowID) else {
                return ObservationResult(
                    captured: false,
                    source: "none",
                    windowId: nil,
                    imagePath: nil,
                    observations: [],
                    combinedText: "",
                    error: "No suitable on-screen application window was found."
                )
            }

            let filter = SCContentFilter(desktopIndependentWindow: window)
            let configuration = SCStreamConfiguration()
            configuration.showsCursor = false
            configuration.width = max(1, Int(window.frame.width.rounded()))
            configuration.height = max(1, Int(window.frame.height.rounded()))
            if #available(macOS 14.0, *) {
                configuration.captureResolution = .best
            }

            let image = try await SCScreenshotManager.captureImage(
                contentFilter: filter,
                configuration: configuration
            )

            let observations = try recognizeText(in: image)
            let combinedText = observations
                .sorted { lhs, rhs in
                    if abs(lhs.y - rhs.y) > 0.02 {
                        return lhs.y < rhs.y
                    }
                    return lhs.x < rhs.x
                }
                .map(\.text)
                .joined(separator: "\n")

            return ObservationResult(
                captured: true,
                source: "window",
                windowId: window.windowID,
                imagePath: nil,
                observations: observations,
                combinedText: combinedText,
                error: nil
            )
        } catch {
            return ObservationResult(
                captured: false,
                source: "none",
                windowId: nil,
                imagePath: nil,
                observations: [],
                combinedText: "",
                error: error.localizedDescription
            )
        }
    }

    private func resolveWindow(
        content: SCShareableContent,
        windowID: UInt32?
    ) -> SCWindow? {
        if let windowID {
            return content.windows.first { $0.windowID == windowID }
        }

        let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        guard let frontmostPID else { return nil }

        return content.windows
            .filter { window in
                window.owningApplication?.processID == frontmostPID && window.isOnScreen
            }
            .filter { $0.frame.width > 100 && $0.frame.height > 100 }
            .sorted {
                ($0.frame.width * $0.frame.height) >
                    ($1.frame.width * $1.frame.height)
            }
            .first
    }

    private func recognizeText(in image: CGImage) throws -> [TextObservation] {
        var results: [TextObservation] = []
        let request = VNRecognizeTextRequest { request, error in
            guard error == nil else { return }
            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                return
            }

            results = observations.compactMap { observation in
                guard let candidate = observation.topCandidates(1).first else {
                    return nil
                }

                return TextObservation(
                    text: candidate.string,
                    confidence: candidate.confidence,
                    x: observation.boundingBox.origin.x,
                    y: observation.boundingBox.origin.y,
                    width: observation.boundingBox.width,
                    height: observation.boundingBox.height
                )
            }
        }

        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
        return results
    }
}

@main
struct MacScreenObserverMain {
    static func main() async {
        let arguments = CommandLine.arguments
        var windowID: UInt32?

        if let index = arguments.firstIndex(of: "--window-id"),
           index + 1 < arguments.count,
           let parsed = UInt32(arguments[index + 1]) {
            windowID = parsed
        }

        if #available(macOS 14.0, *) {
            let result = await Observer().run(windowID: windowID)
            let encoder = JSONEncoder()
            if let data = try? encoder.encode(result) {
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write(Data([0x0A]))
            } else {
                fputs("{\"captured\":false,\"source\":\"none\",\"windowId\":null,\"imagePath\":null,\"observations\":[],\"combinedText\":\"\",\"error\":\"Failed to encode observation result.\"}\n", stderr)
                exit(1)
            }
        } else {
            let result = ObservationResult(
                captured: false,
                source: "none",
                windowId: nil,
                imagePath: nil,
                observations: [],
                combinedText: "",
                error: "Screen observation requires macOS 14 or newer."
            )
            if let data = try? JSONEncoder().encode(result) {
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write(Data([0x0A]))
            }
            exit(1)
        }
    }
}
