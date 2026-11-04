// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

export type TicketStatus = "open" | "claimed" | "resolved" | "out_of_scope";

/** The six ticket fields the star-map reads. Status and frontier are derived upstream. */
export interface StarTicket {
  num: number;
  title: string;
  type: string;
  status: TicketStatus;
  blockedBy: readonly number[];
  frontier: boolean;
}
