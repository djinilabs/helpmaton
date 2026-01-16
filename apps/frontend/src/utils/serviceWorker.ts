const SERVICE_WORKER_URL = "/service-worker.js";
const INVALIDATE_TIMEOUT_MS = 1500;

const isServiceWorkerEnabled = () => {
  if (import.meta.env.MODE === "development") {
    return false;
  }

  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1";
};

export async function registerServiceWorker(): Promise<
  ServiceWorkerRegistration | null
> {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  if (!isServiceWorkerEnabled()) {
    const existingRegistration =
      await navigator.serviceWorker.getRegistration();
    if (existingRegistration) {
      await existingRegistration.unregister();
    }
    return null;
  }

  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  } catch (error) {
    console.error("[service-worker] Registration failed:", error);
    return null;
  }
}

export async function invalidateRootCache(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (!isServiceWorkerEnabled()) {
    return;
  }

  let registration: ServiceWorkerRegistration | null = null;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch (error) {
    console.warn("[service-worker] Ready check failed:", error);
  }

  if (!registration?.active) {
    return;
  }

  const channel = new MessageChannel();
  const completion = new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => resolve(), INVALIDATE_TIMEOUT_MS);
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout);
      resolve();
    };
  });

  registration.active.postMessage(
    { type: "INVALIDATE_ROOT" },
    [channel.port2]
  );

  await completion;
}

export async function checkForServiceWorkerUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (!isServiceWorkerEnabled()) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.update();
    }
  } catch (error) {
    console.warn("[service-worker] Update check failed:", error);
  }
}
