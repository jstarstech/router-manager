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

function CopyableIP({ ip }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(ip);
      } else {
        // Fallback for non-secure (HTTP) contexts
        const textArea = document.createElement("textarea");
        textArea.value = ip;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy!", err);
    }
  };

  return (
    <div
      className="group flex items-center gap-2 cursor-pointer relative"
      onClick={handleCopy}
      title="Click to copy IP"
    >
      <span className="text-paper/90 select-all font-bold tracking-tight">
        {ip}
      </span>
      <div className="opacity-0 group-hover:opacity-40 transition-opacity flex items-center">
        {copied ? (
          <span className="text-[10px] text-sage font-bold uppercase tracking-tighter absolute left-full ml-2 whitespace-nowrap">
            Copied
          </span>
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        )}
      </div>
    </div>
  );
}

function HealthStatusBar({
  promise,
  ipInfoPromise,
  makeIPStatic = () => {},
  isConnected,
}) {
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
              <StatusDot ok={isOk && isConnected} />
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
          <div className="flex items-center">
            <StatusDot ok={isConnected} />
            <span className="opacity-60 mr-1 text-[10px] uppercase">IP:</span>
            <CopyableIP ip={userIP} />
          </div>

          {ipInfoResponse?.status === "ok" ? (
            <>
              {lease["active-agent-circuit-id"] && (
                <p className="flex items-center">
                  <StatusDot ok={isConnected} />
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
                  <StatusDot ok={lease["dynamic"] === "false" && isConnected} />
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
                  <button
                    onClick={makeIPStatic}
                    disabled={!isConnected}
                    className="btn-etched disabled:opacity-30 disabled:cursor-not-allowed"
                  >
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

function PortMapping({ isConnected }) {
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editCommentValue, setEditCommentValue] = useState("");
  const [form, setForm] = useState({
    protocol: "tcp",
    externalPort: "",
    internalPort: "",
    comment: "",
  });

  const mappings = [...(res?.data || [])].sort((a, b) => {
    const portA = parseInt(a.externalPort) || 0;
    const portB = parseInt(b.externalPort) || 0;
    return portA - portB;
  });
  const isDisabled = res?.status === "error";

  const fetchMappings = async () => {
    try {
      const data = await fetchJSON("/api/port-mapping");
      setRes(data);
    } catch (e) {
      setRes({ status: "error", message: e.message });
    }
  };

  useEffect(() => {
    if (isConnected) fetchMappings();
  }, [isConnected]);

  const addMapping = async (e) => {
    e.preventDefault();
    
    const ep = parseInt(form.externalPort, 10);
    const ip = parseInt(form.internalPort, 10);
    if (isNaN(ep) || ep < 1 || ep > 65535) {
      alert("External Port must be a valid number between 1 and 65535.");
      return;
    }
    if (isNaN(ip) || ip < 1 || ip > 65535) {
      alert("Internal Port must be a valid number between 1 and 65535.");
      return;
    }

    setLoading(true);
    try {
      await fetchJSON("/api/port-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ ...form, externalPort: "", internalPort: "", comment: "" });
      fetchMappings();
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMapping = async (id, currentDisabled) => {
    try {
      await fetchJSON("/api/port-mapping", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ".id": id,
          disabled: currentDisabled === "true" ? "false" : "true",
        }),
      });
      fetchMappings();
    } catch (e) {
      alert(e.message);
    }
  };

  const saveComment = async (id) => {
    try {
      await fetchJSON("/api/port-mapping", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ".id": id,
          comment: editCommentValue,
        }),
      });
      setEditingCommentId(null);
      fetchMappings();
    } catch (e) {
      alert(e.message);
    }
  };

  const deleteMapping = async (id) => {
    if (!confirm("Are you sure?")) return;
    try {
      await fetchJSON("/api/port-mapping", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ".id": id }),
      });
      fetchMappings();
    } catch (e) {
      alert(e.message);
    }
  };

  if (isDisabled) return null;

  return (
    <section className="fade-up" style={{ animationDelay: "100ms" }}>
      <DataCard title="Port Mapping">
        <div className="space-y-4">
          <form
            onSubmit={addMapping}
            className="flex flex-wrap items-end gap-3 p-3 bg-paper/5 rounded border border-paper/5"
          >
            <div className="space-y-1">
              <label className="block text-[10px] uppercase opacity-50 font-mono">
                Proto
              </label>
              <select
                className="bg-ink text-rust border border-rust/20 rounded px-2 py-1.5 text-xs font-mono outline-none"
                value={form.protocol}
                onChange={(e) => setForm({ ...form, protocol: e.target.value })}
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </div>
            <div className="space-y-1 flex-1 min-w-[60px]">
              <label className="block text-[10px] uppercase opacity-50 font-mono">
                Ext. Port
              </label>
              <input
                type="text"
                className="w-full bg-ink text-rust border border-rust/20 rounded px-3 py-1.5 text-xs font-mono outline-none focus:border-rust/50"
                placeholder="8080"
                value={form.externalPort}
                onChange={(e) =>
                  setForm({ ...form, externalPort: e.target.value })
                }
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[60px]">
              <label className="block text-[10px] uppercase opacity-50 font-mono">
                Int. Port
              </label>
              <input
                type="text"
                className="w-full bg-ink text-rust border border-rust/20 rounded px-3 py-1.5 text-xs font-mono outline-none focus:border-rust/50"
                placeholder="80"
                value={form.internalPort}
                onChange={(e) =>
                  setForm({ ...form, internalPort: e.target.value })
                }
              />
            </div>
            <div className="space-y-1 flex-[2] min-w-[100px]">
              <label className="block text-[10px] uppercase opacity-50 font-mono">
                Comment
              </label>
              <input
                type="text"
                className="w-full bg-ink text-rust border border-rust/20 rounded px-3 py-1.5 text-xs font-mono outline-none focus:border-rust/50"
                placeholder="Optional description..."
                value={form.comment}
                onChange={(e) =>
                  setForm({ ...form, comment: e.target.value })
                }
              />
            </div>
            <button
              type="submit"
              disabled={loading || !isConnected}
              className="bg-rust text-ink px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider hover:bg-rust/90 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none h-[31px]"
            >
              Add
            </button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-paper/5">
                  <th className="py-2 text-[10px] uppercase opacity-40 font-mono font-normal">
                    Protocol
                  </th>
                  <th className="py-2 text-[10px] uppercase opacity-40 font-mono font-normal">
                    External
                  </th>
                  <th className="py-2 text-[10px] uppercase opacity-40 font-mono font-normal">
                    Internal
                  </th>
                  <th className="py-2 text-[10px] uppercase opacity-40 font-mono font-normal">
                    Comment
                  </th>
                  <th className="py-2 text-[10px] uppercase opacity-40 font-mono font-normal text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper/5">
                {mappings.map((m) => (
                  <tr key={m[".id"]} className="group">
                    <td className="py-3 text-xs font-mono uppercase">
                      {m.protocol}
                      {m.dynamic === "true" && (
                        <span
                          className="ml-2 px-1 bg-gold/10 text-gold text-[8px] border border-gold/20 rounded-sm cursor-help"
                          title="Dynamic rule automatically created by UPnP or NAT-PMP"
                        >
                          {m.comment?.toLowerCase().includes("upnp")
                            ? "UPNP"
                            : m.comment?.toLowerCase().includes("nat-pmp")
                              ? "NAT-PMP"
                              : "DYN"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-xs font-mono text-rust">
                      {m.externalPort}
                    </td>
                    <td className="py-3 text-xs font-mono opacity-70">
                      {m.internalPort}
                    </td>
                    <td className="py-3 text-xs font-mono opacity-80 truncate max-w-[150px]">
                      {editingCommentId === m[".id"] ? (
                        <div className="flex gap-1">
                          <input
                            type="text"
                            autoFocus
                            className="w-full bg-ink text-rust border border-rust/20 rounded px-1.5 py-0.5 text-[10px] outline-none"
                            value={editCommentValue}
                            onChange={(e) => setEditCommentValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveComment(m[".id"]);
                              if (e.key === "Escape") setEditingCommentId(null);
                            }}
                          />
                          <button
                            onClick={() => saveComment(m[".id"])}
                            className="bg-rust/20 text-rust px-1.5 py-0.5 rounded text-[10px] hover:bg-rust hover:text-ink transition-colors"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center gap-2 group/edit cursor-pointer"
                          onClick={() => {
                            if (m.dynamic !== "true") {
                              setEditingCommentId(m[".id"]);
                              setEditCommentValue(m.comment || "");
                            }
                          }}
                        >
                          <span className={!m.comment ? "opacity-30 italic text-[10px]" : ""} title={m.comment}>
                            {m.comment || "no comment"}
                          </span>
                          {m.dynamic !== "true" && (
                            <svg
                              className="w-3 h-3 opacity-0 group-hover/edit:opacity-50 transition-opacity"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end items-center gap-2">
                        <button
                          onClick={() => toggleMapping(m[".id"], m.disabled)}
                          disabled={m.dynamic === "true"}
                          title={m.dynamic === "true" ? "Dynamic rules cannot be disabled manually" : ""}
                          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded transition-colors ${m.dynamic === "true" ? "bg-paper/5 text-paper/20 cursor-not-allowed" : m.disabled === "true" ? "bg-paper/10 text-paper/40" : "bg-rust/20 text-rust"}`}
                        >
                          {m.disabled === "true" ? "Disabled" : "Active"}
                        </button>
                        <button
                          onClick={() => deleteMapping(m[".id"])}
                          disabled={m.dynamic === "true"}
                          title={m.dynamic === "true" ? "Dynamic rules cannot be removed manually" : ""}
                          className={`p-1.5 transition-colors ${m.dynamic === "true" ? "text-paper/5 cursor-not-allowed" : "text-paper/20 hover:text-red-400"}`}
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {mappings.length === 0 && (
                  <tr>
                    <td
                      colSpan="5"
                      className="py-8 text-center text-[10px] uppercase opacity-20 tracking-widest"
                    >
                      No port mappings defined
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DataCard>
    </section>
  );
}

function IPRuleTable({ isConnected }) {
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
    if (!isConnected) return;
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
          <div
            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-opacity ${isConnected ? "opacity-100" : "opacity-50"}`}
          >
            <div className="space-y-1">
              <p className="text-paper/90 font-bold">Active Routing Rule</p>
              <p className="text-[10px] text-paper/40 leading-tight">
                Traffic from your IP is currently being processed by the table
                selected below.
              </p>
            </div>
            <div className="relative group">
              <select
                className="appearance-none bg-ink text-rust border border-rust/20 hover:border-rust/40 active:border-rust focus:border-rust outline-none rounded px-4 py-2 text-sm font-mono transition-all pr-10 cursor-pointer disabled:cursor-not-allowed"
                value={selectedTable}
                onChange={changeTable}
                disabled={!isConnected}
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
    <div className="flex items-center justify-center h-screen w-full">
      <div
        className="flex flex-col items-center gap-3"
        style={{ color: "color-mix(in srgb, var(--color-paper) 30%, transparent)" }}
      >
        <svg
          className="animate-spin w-5 h-5"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      </div>
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
  const isConnected = healthResponse?.connected !== false;

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
    if (!isConnected) return;
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
      className="min-h-screen selection:bg-rust/30 transition-opacity duration-700"
      style={{
        background: "var(--color-ink)",
        color: "var(--color-paper)",
        opacity: isConnected ? 1 : 0.7,
      }}
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
          background: `radial-gradient(circle at 80% 20%, color-mix(in srgb, var(${isConnected ? "--color-rust" : "--color-gold"}) 5%, transparent) 0%, transparent 70%)`,
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
            <div className="flex flex-col items-end gap-1">
              <div className="font-mono text-[10px] opacity-20 uppercase tracking-[0.2em]">
                {version}
              </div>
              {!isConnected && (
                <div className="font-mono text-[9px] text-gold uppercase tracking-widest animate-pulse">
                  Offline • Reconnecting
                </div>
              )}
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
            isConnected={isConnected}
          />
        </header>

        <section className="space-y-8" style={fadeUp(100)}>
          <PortMapping isConnected={isConnected} />
          <IPRuleTable isConnected={isConnected} />
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
