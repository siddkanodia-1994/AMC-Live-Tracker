import dns from "node:dns";

// Local-only: some routers refuse DNS for *.neon.tech, which breaks agent-cli
// (ledger rows, read-only SQL) with "fetch failed". When the system lookup
// of a *.neon.tech host fails, retry it through public resolvers. Any other
// host, or a lookup that succeeds, is untouched.

const resolver = new dns.Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);
const systemLookup = dns.lookup.bind(dns);

type Callback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

function patchedLookup(hostname: string, options: unknown, callback?: unknown): void {
  const cb = (typeof options === "function" ? options : callback) as Callback;
  const opts = (typeof options === "function" ? {} : typeof options === "number" ? { family: options } : (options ?? {})) as dns.LookupOptions;
  systemLookup(hostname, opts as dns.LookupAllOptions, ((err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => {
    if (!err || !hostname.endsWith(".neon.tech")) return cb(err, address, family);
    resolver.resolve4(hostname, (rErr, addrs) => {
      if (rErr || !addrs.length) return cb(err);
      if (opts.all) return cb(null, addrs.map((a) => ({ address: a, family: 4 })));
      cb(null, addrs[0], 4);
    });
  }) as never);
}

(dns as unknown as { lookup: typeof patchedLookup }).lookup = patchedLookup;
