/**
 * What the wall is told, and what it lays out.
 *
 * The snapshot is assembled on the server from the control plane's public API and handed to the
 * client as plain data. The layout types are the client's own working set. Nothing here reaches
 * the control plane's address or any credential.
 */

/** The collection's supply: one seat per identity.md NFT, so one module per seat on the wall. */
export const SEATS = 2000;

/** A seat that has done work, as the wall needs it: how much, how it went, and whether it is busy. */
export type SeatRecord = {
  tokenId: number;
  agentId: string | null;
  /** Nodes it ran, by verdict. */
  accepted: number;
  failed: number;
  /**
   * The rest of its record: everything it submitted, what was turned down, and what nobody has
   * judged yet. Optional because a plane older than the tally route answers without them, and a
   * rate quoted from counts that are not there would be a made-up number.
   */
  attempts?: number;
  rejected?: number;
  pending?: number;
  /** When it last worked: its newest submission, or a node of its own that moved, ISO. A heartbeat does not move it. */
  last: string | null;
  /** Holding a live lease right now. */
  working: boolean;
  /** Nodes it is next in line for. */
  queued: number;
};

/**
 * One line of the terminal: the life of the swarm as it happens. A task posted, an agent picking
 * a node up, a verdict, reviews going onchain, a site named, a launch going live, an agent
 * joining.
 */
export type MachineEvent =
  | { kind: "job"; at: string; jobId: string; objective: string }
  /** A job's last line: it completed, with how many of its steps were accepted, or it stopped, with why. */
  | { kind: "done"; at: string; jobId: string; objective: string; state: "completed" | "blocked" | "cancelled"; steps: number; failure: string | null }
  | { kind: "node"; at: string; tokenId: number | null; step: string; role: string; state: string; jobId: string; objective: string; reason: string | null }
  | { kind: "review"; at: string; jobId: string; objective: string; txHash: string | null; chainId: number | null; scores: number; accepted?: number }
  | { kind: "site"; at: string; jobId: string; objective: string; ensName: string | null; cid: string | null }
  | { kind: "launch"; at: string; launchId: string; launchNumber: number; chainId: number; status: string; token?: string | null }
  | { kind: "agent"; at: string; tokenId: number; state: "joined" };

/** The figures the monitor reads out. */
export type MachineHealth = {
  reachable: boolean;
  agentsOnline: number;
  workingNow: number;
  acceptedLastDay: number;
  /** Jobs that completed in the last day, and oracle questions apart from them. */
  jobsDoneLastDay?: number;
  oraclesDoneLastDay?: number;
  seatsEnrolled: number;
  pendingVerification: number;
  pendingDeployment: number;
  pendingSites: number;
  verifierUp: boolean | null;
  publisherUp: boolean | null;
  deployerUp: boolean | null;
};

export type MachineCounts = {
  jobs: number;
  jobStates: Record<string, number>;
  /** Workflows under way plus standalone jobs executing. */
  tasksInProgress: number;
  launchesLive: number;
  sites: number;
  /** Tokens of inference contributed, all contributors, all time. */
  inferenceTokens: number;
};

export type MachineSnapshot = {
  /** When the server read this, ms since epoch. */
  at: number;
  health: MachineHealth;
  counts: MachineCounts;
  seats: Record<number, SeatRecord>;
  events: MachineEvent[];
  /**
   * Holder of each token, index = tokenId, from the control plane's `/seats/owners`. With it the
   * wall draws one module per wallet sized by the seats it holds; without it (an older control
   * plane, or its chain unreadable), one module per seat.
   */
  owners?: Array<string | null>;
  /** The chain and contract the seats live on, for a link to a token or a holder. */
  chain?: { chainId: number; collection: string };
};

/** How busy a module is, in rising order. Drives the lamp, the outline and the motion. */
export type Activity = 0 | 1 | 2 | 3;
export const IDLE: Activity = 0;
export const HAS_WORKED: Activity = 1;
export const RECENT: Activity = 2;
export const WORKING: Activity = 3;

/** A module on the wall: a wallet's seats, where it sits in cells, and how busy it is. */
export type Unit = {
  owner: string | null;
  ids: number[];
  first: number;
  c: number;
  r: number;
  w: number;
  h: number;
  activity: Activity;
  /** Draws as a node screen rather than an instrument: it has an active seat. */
  node: boolean;
  /** The seat the screen speaks for, when it is a node. */
  seat: number;
  /** When any of its seats last moved, ms since the epoch, or 0. */
  last: number;
};

/** A black screen packed into the wall: the operator's monitor. */
export type Block = {
  /** The operator's monitor, the switch that turns the room's sound on, or the cog at the top right. */
  kind: "monitor" | "listen" | "settings";
  /** Columns of wall the block reserves on either side of what it draws; a phone gives the monitor one. */
  pad?: number;
  c: number;
  r: number;
  w: number;
  h: number;
  tab: number;
  /** When the tab last changed, ms. */
  since: number;
  /** When a reader pinned a tab, ms, or 0. */
  pinned: number;
  tabRects: Array<{ x: number; y: number; w: number; h: number; i: number }>;
};

export type Layout = {
  cols: number;
  rows: number;
  cell: number;
  units: Unit[];
  /** Cell → unit index, or -1 - block index, or undefined when bare wall. */
  grid: Array<number | undefined>;
  blocks: Block[];
};
