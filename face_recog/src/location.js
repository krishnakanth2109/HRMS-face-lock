function requestPosition(options) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

export async function getCurrentLocation() {
  try {
    const position = await requestPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch (highAccuracyError) {
    try {
      const fallbackPosition = await requestPosition({
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 30000,
      });

      return {
        latitude: fallbackPosition.coords.latitude,
        longitude: fallbackPosition.coords.longitude,
      };
    } catch (fallbackError) {
      if (fallbackError.code === 1) {
        throw new Error("Location access denied. Please allow location permission.");
      }

      if (fallbackError.code === 2) {
        throw new Error("Unable to detect your location. Please enable GPS and try again.");
      }

      if (fallbackError.code === 3) {
        throw new Error("Location request timed out. Please try again.");
      }

      throw new Error(
        highAccuracyError?.message ||
          fallbackError?.message ||
          "Unable to retrieve location."
      );
    }
  }
}
