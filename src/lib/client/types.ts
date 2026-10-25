export type RunCommand = (command: string, input: unknown, message?: string) => Promise<string | undefined>;
