import type {
  CommandEnvelope,
  CommandResponseEnvelope,
} from "@magick/contracts/ws";

export interface AgentTransportInterface {
  handleCommand(
    envelope: CommandEnvelope,
    connectionId: string,
  ): Promise<CommandResponseEnvelope>;
}
