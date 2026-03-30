import { useState, useEffect, useTransition, use, Suspense } from "react";

/**
 * Format a duration string (e.g. "1w2d3h4m5s") into a human-readable format (e.g. "1d 03:04:05")
 * @param {string} duration - The duration string to format
 * @returns {string} - The formatted duration string
 */
function formatDurationToDaysTime(duration) {
  const multipliers = {
    w: 7 * 24 * 3600,
    d: 24 * 3600,
    h: 3600,
    m: 60,
    s: 1,
  };

  // 1. Extract numbers and units using regex
  const regex = /(\d+)([wdhms])/g;
  let totalSeconds = 0;
  let match;

  while ((match = regex.exec(duration)) !== null) {
    totalSeconds += parseInt(match[1]) * multipliers[match[2]];
  }

  // 2. Calculate days and remaining parts
  const days = Math.floor(totalSeconds / (24 * 3600));
  const remainingSeconds = totalSeconds % (24 * 3600);

  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  // 3. Format as "Xd HH:mm:ss"
  const pad = (num) => String(num).padStart(2, "0");
  return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Fetches a JSON response from the given URL, with an optional init object.
 * If the response is not OK, throws an error with the status and statusText.
 * @param {string} url The URL to fetch.
 * @param {object} [init] Optional init object to pass to fetch.
 * @returns {Promise<JSON>} A promise that resolves with the JSON response.
 */
function fetchJSON(url, init = {}) {
  return fetch(url, init).then((r) => {
    if (!r.ok) {
      throw new Error(`${r.status} ${r.statusText}`);
    }

    return r.json();
  });
}

/**
 * A small dot that indicates the status of something.
 * @param {{ ok: boolean }} Props
 * @param {boolean} ok If true, the dot is green; otherwise, it is red.
 */
function StatusDot({ ok }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mr-2"
      style={{
        backgroundColor: ok ? "#4ade80" : "#f87171",
        animation: "var(--animate-pulse-slow)",
      }}
    />
  );
}

function HealthStatusBar({ promise, ipInfoPromise, makeIPStatic = () => {} }) {
  const response = use(promise);
  const ipInfoResponse = use(ipInfoPromise);
  const isOk = response?.status === "ok";
  const data = response.data.info || {};

  return (
    <div className="flex items-center gap-2 mb-6">
      <span
        className="font-mono text-xs"
        style={{
          color: "color-mix(in srgb, var(--color-paper) 30%, transparent)",
        }}
      >
        {isOk ? (
          <>
            <p>
              {data.platform} {data["board-name"]} ({data["architecture-name"]})
              · Software : {data.version}
            </p>
            <p>&nbsp;</p>
            <p>
              <StatusDot ok={isOk} /> Uptime:{" "}
              {formatDurationToDaysTime(data.uptime)}
            </p>

            <p>
              <StatusDot ok={true} /> IP: {response.data["user-ip"]}
            </p>
          </>
        ) : (
          <p>Error fetching status</p>
        )}

        {ipInfoResponse?.status === "ok" ? (
          <>
            {ipInfoResponse.data["lease"]["active-agent-circuit-id"] && (
              <>
                <p>
                  <StatusDot ok={true} /> Bridge Port:{" "}
                  <span className="text-rust">
                    {ipInfoResponse.data["bridge-port"]}
                  </span>
                </p>
                <p>
                  <StatusDot ok={true} /> Active agent circuit id:{" "}
                  <span className="text-rust">
                    {ipInfoResponse.data["lease"]["active-agent-circuit-id"]}
                  </span>
                </p>
              </>
            )}
            <p>
              {ipInfoResponse.data["lease"]["dynamic"] === "false" ? (
                <>
                  <StatusDot ok={true} /> DHCP Lease: static
                </>
              ) : (
                <>
                  <StatusDot ok={false} /> DHCP Lease: dynamic{" "}
                  <span
                    className="cursor-pointer hover:text-rust"
                    onClick={makeIPStatic}
                  >
                    [make static]
                  </span>
                </>
              )}
            </p>
          </>
        ) : (
          <p>Error fetching IP info</p>
        )}
      </span>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div
      className="font-mono text-sm"
      style={{
        color: "color-mix(in srgb, var(--color-paper) 30%, transparent)",
        animation: "pulse 2s ease-in-out infinite",
      }}
    >
      fetching...
    </div>
  );
}

export default function App() {
  // React 19: store promises directly in state — use() unwraps in Suspense
  const [healthPromise, setHealthPromise] = useState(() =>
    fetchJSON("/api/health"),
  );
  const [ipInfoPromise, setIpInfoPromise] = useState(() =>
    fetchJSON("/api/ip-info"),
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let isCancelled = false;

    async function poll() {
      if (isCancelled) return;

      const nextPromise = fetchJSON("/api/health", {
        signal: AbortSignal.timeout(5000),
      });

      startTransition(() => {
        setHealthPromise(nextPromise);
      });

      try {
        await nextPromise;
      } catch (e) {
        setHealthPromise(
          Promise.resolve({
            status: "error",
            message: e.message,
          }),
        );
      }

      if (!isCancelled) {
        setTimeout(poll, 5000);
      }
    }

    poll();

    return () => {
      isCancelled = true;
    };
  }, []);

  const makeIPStatic = async () => {
    try {
      const response = await fetchJSON("/api/dhcp-make-static");

      if (response.status === "ok") {
        startTransition(() => {
          setIpInfoPromise(fetchJSON("/api/ip-info"));
        });
      } else {
        alert("Failed to make IP address static " + response.message);
      }
    } catch (error) {
      alert("Error making IP address static: " + error.message);
    }
  };

  const fadeUp = (delay = 0) => ({
    animation: "var(--animate-fade-up)",
    animationDelay: `${delay}ms`,
    opacity: 0,
  });

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-ink)", color: "var(--color-paper)" }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          opacity: 0.03,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div
        className="fixed top-0 right-0 w-[600px] h-[600px] pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 80% 20%, color-mix(in srgb, var(--color-rust) 8%, transparent) 0%, transparent 60%)",
        }}
      />

      <div className="relative max-w-3xl mx-auto px-6 py-16">
        <header className="mb-16" style={fadeUp(0)}>
          <h1
            className="text-2xl md:text-4xl leading-none mb-4 tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Router{" "}
            <em style={{ color: "var(--color-rust)", fontStyle: "italic" }}>
              Manager
            </em>
          </h1>
          <p
            className="font-mono text-sm leading-relaxed max-w-md"
            style={{
              color: "color-mix(in srgb, var(--color-paper) 40%, transparent)",
            }}
          ></p>

          <hr className="my-3 border-[color-mix(in_srgb,var(--color-paper)_8%,transparent)]" />

          <Suspense fallback={<LoadingFallback />}>
            <HealthStatusBar
              promise={healthPromise}
              ipInfoPromise={ipInfoPromise}
              makeIPStatic={makeIPStatic}
            />
          </Suspense>
        </header>

        <footer
          className="mt-16 pt-8"
          style={{
            borderTop:
              "1px solid color-mix(in srgb, var(--color-paper) 8%, transparent)",
          }}
        >
          <p
            className="font-mono text-xs"
            style={{
              color: "color-mix(in srgb, var(--color-paper) 20%, transparent)",
            }}
          >
            Router Manager
          </p>
        </footer>
      </div>
    </div>
  );
}
