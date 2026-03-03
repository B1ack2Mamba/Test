import { useEffect, useState } from "react";

export function NativeActions() {
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const core = await import("@capacitor/core");
        setIsNative(core.Capacitor.isNativePlatform());
      } catch {
        setIsNative(false);
      }
    })();
  }, []);

  if (!isNative) return null;

  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={() => {
        try {
          window.location.reload();
        } catch {
          // ignore
        }
      }}
      title="Обновить"
    >
      ↻
    </button>
  );
}
