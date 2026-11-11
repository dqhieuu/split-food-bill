export type RunCommand = (command: string, input: unknown, message?: string) => Promise<string | undefined>;
export type ConfigureGroup = (groupId: string, command: string, input: unknown) => Promise<string>;
