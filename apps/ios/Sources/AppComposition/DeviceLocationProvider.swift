import CoreDomain
import FeatureMap
import Foundation

#if canImport(CoreLocation) && os(iOS)
    import CoreLocation
#endif

/// One device fix, and one compass heading, on demand.
///
/// Deliberately not a continuous stream. Georeferencing needs a single answer
/// to "where am I standing", and a location manager left running is a battery
/// cost paid for a screen somebody has already left. It is also why nothing
/// here is asked for at launch: the permission prompt belongs to the button
/// that needs it.
///
/// Both answers are proposals. A fix carries its own accuracy and a heading
/// carries none, which is why the georeference screen accepts the first
/// directly and holds the second until somebody agrees with it — a phone in a
/// pocket near a fence produces confident nonsense.
@MainActor
public final class DeviceLocationProvider: NSObject {
    #if canImport(CoreLocation) && os(iOS)
        private let manager = CLLocationManager()
        private var fixContinuation: CheckedContinuation<GeoreferenceViewModel.DeviceFix?, Never>?
        private var headingContinuation: CheckedContinuation<Double?, Never>?
    #endif

    public override init() {
        super.init()
        #if canImport(CoreLocation) && os(iOS)
            manager.delegate = self
            // Whole-metre accuracy is what a garden anchor is worth. Asking for
            // best-available would spend power chasing precision the rest of
            // this pipeline rounds away at 1 mm anyway — and the anchor is a
            // proposal a person then corrects by dragging.
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        #endif
    }

    /// A single fix, or `.denied` when the answer is a refusal rather than a
    /// position. `nil` means the request produced nothing at all.
    public func currentFix() async -> GeoreferenceViewModel.DeviceFix? {
        #if canImport(CoreLocation) && os(iOS)
            switch manager.authorizationStatus {
            case .denied, .restricted:
                return .denied
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            default:
                break
            }

            return await withCheckedContinuation { continuation in
                fixContinuation = continuation
                manager.requestLocation()
            }
        #else
            return nil
        #endif
    }

    /// One heading, in degrees clockwise from true north. `nil` where the
    /// hardware or the platform has none — which is an ordinary answer, not a
    /// failure, and leaves the dial where the person left it.
    public func currentHeading() async -> Double? {
        #if canImport(CoreLocation) && os(iOS)
            guard CLLocationManager.headingAvailable() else { return nil }
            return await withCheckedContinuation { continuation in
                headingContinuation = continuation
                manager.startUpdatingHeading()
            }
        #else
            return nil
        #endif
    }
}

#if canImport(CoreLocation) && os(iOS)
    extension DeviceLocationProvider: CLLocationManagerDelegate {
        public nonisolated func locationManager(
            _: CLLocationManager,
            didUpdateLocations locations: [CLLocation]
        ) {
            // Only plain numbers cross to the main actor: `CLLocation` is not
            // `Sendable`, and sending it is the mistake the iOS build catches
            // and the macOS build does not.
            guard let last = locations.last else { return }
            let longitude = last.coordinate.longitude
            let latitude = last.coordinate.latitude
            // A negative horizontal accuracy means the fix is invalid, not
            // that it is very good.
            let accuracy = last.horizontalAccuracy >= 0 ? last.horizontalAccuracy : nil

            Task { @MainActor [weak self] in
                self?.resumeFix(
                    .init(
                        position: Position(x: longitude, y: latitude),
                        accuracyMetres: accuracy
                    )
                )
            }
        }

        public nonisolated func locationManager(
            _: CLLocationManager,
            didFailWithError _: Error
        ) {
            Task { @MainActor [weak self] in self?.resumeFix(nil) }
        }

        public nonisolated func locationManager(
            _: CLLocationManager,
            didUpdateHeading newHeading: CLHeading
        ) {
            // True heading is negative until the device has a location fix to
            // resolve magnetic declination against; magnetic is the honest
            // fallback rather than a made-up correction.
            let degrees = newHeading.trueHeading >= 0
                ? newHeading.trueHeading
                : newHeading.magneticHeading
            Task { @MainActor [weak self] in self?.resumeHeading(degrees) }
        }

        private func resumeFix(_ fix: GeoreferenceViewModel.DeviceFix?) {
            fixContinuation?.resume(returning: fix)
            fixContinuation = nil
        }

        private func resumeHeading(_ degrees: Double?) {
            manager.stopUpdatingHeading()
            headingContinuation?.resume(returning: degrees)
            headingContinuation = nil
        }
    }
#endif
