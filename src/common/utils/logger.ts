export function prettyTransport(): { target: string } | void {
	try {
		import.meta.resolve("pino-pretty");
		return { target: "pino-pretty" };
	} catch {
		return;
	}
}
