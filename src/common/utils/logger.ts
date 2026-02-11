export function prettyTransport(): { target: string } | undefined {
	try {
		import.meta.resolve("pino-pretty");
		return { target: "pino-pretty" };
	} catch {
		return;
	}
}
