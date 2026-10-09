import { z } from "zod";

// The runtime's Content-Security-Policy forbids eval; without this, Zod probes `new Function`.
// It is its own module, imported first, because some modules parse schemas while they load.
z.config({ jitless: true });
