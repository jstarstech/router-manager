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
  return fetch(url, init).then(async (r) => {
    let data;
    try {
      data = await r.json();
    } catch (e) {
      // Not JSON
    }

    if (!r.ok) {
      throw new Error(data?.message || `${r.status} ${r.statusText}`);
    }

    return data;
  });
}

function fetchJSONOrError(url, init = {}) {
  return fetchJSON(url, init).catch((error) => ({
    status: "error",
    message: error.message,
  }));
}

/**
 * A small dot that indicates the status of something.
 * @param {{ ok: boolean }} Props
 * @param {boolean} ok If true, the dot is green; otherwise, it is red.
 */
function StatusDot({ ok }) {
  const color = ok ? "#4ade80" : "#f87171";
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full mr-2.5"
      style={{
        backgroundColor: color,
        boxShadow: `0 0 8px ${color}`,
        animation: "var(--animate-pulse-slow)",
      }}
    />
  );
}

function DataCard({ title, children, icon }) {
  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{
            color: "color-mix(in srgb, var(--color-paper) 30%, transparent)",
          }}
        >
          {title}
        </span>
        {icon && <span className="opacity-20">{icon}</span>}
      </header>
      <div className="font-mono text-xs space-y-2">{children}</div>
    </div>
  );
}

function HealthStatusBar({ promise, ipInfoPromise, makeIPStatic = () => {} }) {
  const response = use(promise);
  const ipInfoResponse = use(ipInfoPromise);
  const isOk = response?.status === "ok";
  const data = response.data?.info || {};
  const userIP = response.data?.["user-ip"] || "unknown";
  const lease = ipInfoResponse?.data?.lease || {};

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
      <DataCard title="System Identity">
        {isOk ? (
          <>
            <p className="text-paper/80">
              {data.platform} {data["board-name"]}
            </p>
            <p
              className="text-[10px]"
              style={{
                color:
                  "color-mix(in srgb, var(--color-paper) 40%, transparent)",
              }}
            >
              Arch: {data["architecture-name"]} · Soft: {data.version}
            </p>
            <p className="pt-2 flex items-center">
              <StatusDot ok={isOk} />
              <span className="opacity-60 mr-1 text-[10px] uppercase">
                Uptime:
              </span>
              <span className="text-rust">
                {formatDurationToDaysTime(data.uptime)}
              </span>
            </p>
          </>
        ) : (
          <p className="text-rust italic text-[10px]">
            System identity unreachable
          </p>
        )}
      </DataCard>

      <DataCard title="Client Connection">
        <div className="space-y-2">
          <p className="flex items-center">
            <StatusDot ok={true} />
            <span className="opacity-60 mr-1 text-[10px] uppercase">IP:</span>
            <span className="text-paper/90 select-all font-bold tracking-tight">
              {userIP}
            </span>
          </p>

          {ipInfoResponse?.status === "ok" ? (
            <>
              {lease["active-agent-circuit-id"] && (
                <p className="flex items-center">
                  <StatusDot ok={true} />
                  <span className="opacity-60 mr-1 text-[10px] uppercase">
                    Port:
                  </span>
                  <span className="text-rust font-bold">
                    {ipInfoResponse.data?.["bridge-port"]}
                  </span>
                </p>
              )}
              <div className="pt-2 flex items-center justify-between border-t border-paper/5 mt-2 pt-3">
                <p className="flex items-center">
                  <StatusDot ok={lease["dynamic"] === "false"} />
                  <span className="opacity-60 mr-1 text-[10px] uppercase">
                    Lease:
                  </span>
                  <span
                    className={
                      lease["dynamic"] === "false" ? "text-sage" : "text-gold"
                    }
                  >
                    {lease["dynamic"] === "false" ? "Static" : "Dynamic"}
                  </span>
                </p>
                {lease["dynamic"] !== "false" && (
                  <button onClick={makeIPStatic} className="btn-etched">
                    Fix IP
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="pt-2 border-t border-paper/5 mt-2 pt-3">
              {ipInfoResponse?.status === "error" &&
              ipInfoResponse?.message === "ip not found" ? (
                <p className="flex items-center text-rust/80 italic text-[10px]">
                  <StatusDot ok={false} /> No DHCP lease for {userIP}
                </p>
              ) : (
                <p className="flex items-center text-rust italic text-[10px]">
                  <StatusDot ok={false} /> IP info pending...
                </p>
              )}
            </div>
          )}
        </div>
      </DataCard>
    </div>
  );
}

function IPRuleTable() {
  const [resRule, setRes] = useState(null);
  const [resTables, setTables] = useState(null);
  const [selectedTable, setSelectedTable] = useState("");

  const tables = resTables?.data || [];

  useEffect(() => {
    async function poll() {
      const [_resRule, _resTables] = await Promise.all([
        fetchJSON("/api/ip-rule"),
        fetchJSON("/api/ip-rule-tables"),
      ]);

      setRes(_resRule);
      setSelectedTable(_resRule.data?.table || "");
      setTables(_resTables);
    }
    poll();
  }, []);

  const changeTable = async (e) => {
    const value = e.target.value;

    const res = await fetchJSON("/api/ip-rule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ table: value, ".id": resRule?.data?.[".id"] }),
    });

    if (res.status === "ok") {
      setSelectedTable(value);
    }
  };

  if (resRule?.status === "ok" && resRule?.data && resRule.data?.table) {
    return (
      <section className="fade-up" style={{ animationDelay: "200ms" }}>
        <DataCard title="Traffic Routing">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-paper/90 font-bold">Active Routing Rule</p>
              <p className="text-[10px] text-paper/40 leading-tight">
                Traffic from your IP is currently being processed by the table
                selected below.
              </p>
            </div>
            <div className="relative group">
              <select
                className="appearance-none bg-ink text-rust border border-rust/20 hover:border-rust/40 active:border-rust focus:border-rust outline-none rounded px-4 py-2 text-sm font-mono transition-all pr-10 cursor-pointer"
                value={selectedTable}
                onChange={changeTable}
              >
                {tables.map((table) => (
                  <option key={table["name"]} value={table["name"]}>
                    {table.name}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40 group-hover:opacity-100 transition-opacity">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M3 4.5L6 7.5L9 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </DataCard>
      </section>
    );
  }

  return <></>;
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
    fetchJSONOrError("/api/health"),
  );
  const [ipInfoPromise, setIpInfoPromise] = useState(() =>
    fetchJSONOrError("/api/ip-info"),
  );
  const [isPending, startTransition] = useTransition();

  return (
    <Suspense fallback={<LoadingFallback />}>
      <AppContent
        healthPromise={healthPromise}
        setHealthPromise={setHealthPromise}
        ipInfoPromise={ipInfoPromise}
        setIpInfoPromise={setIpInfoPromise}
        isPending={isPending}
        startTransition={startTransition}
      />
    </Suspense>
  );
}

function AppContent({
  healthPromise,
  setHealthPromise,
  ipInfoPromise,
  setIpInfoPromise,
  isPending,
  startTransition,
}) {
  const healthResponse = use(healthPromise);
  const version = healthResponse?.version || "dev";

  useEffect(() => {
    let isCancelled = false;

    async function poll() {
      if (isCancelled) return;

      const nextPromise = fetchJSONOrError("/api/health", {
        signal: AbortSignal.timeout(5000),
      });

      startTransition(() => {
        setHealthPromise(nextPromise);
      });

      await nextPromise;

      if (!isCancelled) {
        setTimeout(poll, 5000);
      }
    }

    poll();

    return () => {
      isCancelled = true;
    };
  }, [setHealthPromise, startTransition]);

  const makeIPStatic = async () => {
    try {
      const response = await fetchJSON("/api/dhcp-make-static", {
        method: "POST",
      });

      if (response.status === "ok") {
        startTransition(() => {
          setIpInfoPromise(fetchJSONOrError("/api/ip-info"));
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
      className="min-h-screen selection:bg-rust/30"
      style={{ background: "var(--color-ink)", color: "var(--color-paper)" }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          opacity: 0.02,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div
        className="fixed top-0 right-0 w-[800px] h-[800px] pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 80% 20%, color-mix(in srgb, var(--color-rust) 5%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="relative max-w-4xl mx-auto px-6 py-12 md:py-24">
        <header className="mb-12" style={fadeUp(0)}>
          <div className="flex items-baseline justify-between mb-6">
            <h1
              className="text-3xl md:text-5xl leading-none tracking-tighter"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Router{" "}
              <em style={{ color: "var(--color-rust)", fontStyle: "italic" }}>
                Manager
              </em>
            </h1>
            <div className="font-mono text-[10px] opacity-20 uppercase tracking-[0.2em]">
              v{version}
            </div>
          </div>

          <p
            className="font-mono text-xs leading-relaxed max-w-md mb-8"
            style={{
              color: "color-mix(in srgb, var(--color-paper) 40%, transparent)",
            }}
          >
            A high-performance control interface for RouterOS network devices,
            optimized for real-time monitoring and routing management.
          </p>

          <HealthStatusBar
            promise={healthPromise}
            ipInfoPromise={ipInfoPromise}
            makeIPStatic={makeIPStatic}
          />
        </header>

        <section className="space-y-8" style={fadeUp(100)}>
          <IPRuleTable />
        </section>

        <footer
          className="mt-24 pt-8 flex items-center justify-between"
          style={{
            borderTop:
              "1px solid color-mix(in srgb, var(--color-paper) 5%, transparent)",
          }}
        >
          <p
            className="font-mono text-[10px] uppercase tracking-widest"
            style={{
              color: "color-mix(in srgb, var(--color-paper) 20%, transparent)",
            }}
          >
            © 2026 Router Manager System
          </p>
          <div className="flex gap-4 opacity-20 hover:opacity-100 transition-opacity">
            <div className="w-1 h-1 rounded-full bg-paper" />
            <div className="w-1 h-1 rounded-full bg-paper" />
            <div className="w-1 h-1 rounded-full bg-paper" />
          </div>
        </footer>
      </div>
    </div>
  );
}
