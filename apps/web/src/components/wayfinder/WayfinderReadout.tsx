import type {
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  WayfinderDocument,
  WayfinderMapSummary,
  WayfinderProblem,
  WayfinderTicketStatus,
  WayfinderTicketSummary,
} from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { ArrowLeft, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { type EnvironmentQueryView, useEnvironmentQuery } from "../../state/query";
import { wayfinderMapDocumentAtom, wayfinderTicketDocumentAtom } from "../../state/wayfinder";
import ChatMarkdown from "../ChatMarkdown";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Skeleton } from "../ui/skeleton";
import { PROBLEM_REASON_COPY, tildeRoot } from "./wayfinderCopy";
import { WayfinderTicketActions } from "./WayfinderTicketActions";

export const READOUT_FOCUS_ATTRIBUTE = "data-wayfinder-focus";

interface ReadoutContext {
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly cwd: string;
  readonly root: string;
}

const STATUS_COPY: Record<
  WayfinderTicketStatus,
  { label: string; variant: "info" | "warning" | "success" | "outline" }
> = {
  open: { label: "Open", variant: "info" },
  claimed: { label: "Claimed", variant: "warning" },
  resolved: { label: "Resolved", variant: "success" },
  out_of_scope: { label: "Out of scope", variant: "outline" },
};

function StatusBadge(props: { readonly status: WayfinderTicketStatus }) {
  const copy = STATUS_COPY[props.status];
  return <Badge variant={copy.variant}>{copy.label}</Badge>;
}

function TicketRow(props: {
  readonly number: number;
  readonly children: React.ReactNode;
  readonly onSelect: ((number: number) => void) | null;
}) {
  const content = (
    <>
      <span className="w-7 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
        {props.number}
      </span>
      {props.children}
    </>
  );
  if (props.onSelect === null) {
    return <li className="flex min-h-7 items-center gap-2 px-2 text-sm">{content}</li>;
  }
  const onSelect = props.onSelect;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(props.number)}
        className="flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 pointer-coarse:min-h-11"
      >
        {content}
      </button>
    </li>
  );
}

function TicketReferenceRows(props: {
  readonly label: string;
  readonly numbers: readonly number[];
  readonly map: WayfinderMapSummary;
  readonly onSelect: (number: number) => void;
}) {
  if (props.numbers.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <SectionLabel>{props.label}</SectionLabel>
      <ul className="flex flex-col gap-1.5">
        {props.numbers.map((number) => {
          const ticket = props.map.tickets.find((entry) => entry.number === number);
          return ticket === undefined ? (
            <TicketRow key={number} number={number} onSelect={null}>
              <span className="text-muted-foreground">not found</span>
            </TicketRow>
          ) : (
            <TicketRow key={number} number={number} onSelect={props.onSelect}>
              <span className="min-w-0 flex-1 truncate text-foreground">{ticket.title}</span>
              <StatusBadge status={ticket.status} />
            </TicketRow>
          );
        })}
      </ul>
    </section>
  );
}

function SectionLabel(props: { readonly children: React.ReactNode; readonly id?: string }) {
  return (
    <h3
      id={props.id}
      tabIndex={props.id === undefined ? undefined : -1}
      {...(props.id === undefined ? {} : { [READOUT_FOCUS_ATTRIBUTE]: props.id })}
      className="text-xs font-medium text-muted-foreground outline-none"
    >
      {props.children}
    </h3>
  );
}

function ProblemsAlert(props: { readonly problems: readonly WayfinderProblem[] }) {
  if (props.problems.length === 0) return null;
  return (
    <Alert variant="warning" controlAlignment="first-line">
      <TriangleAlertIcon />
      <AlertDescription>
        {props.problems.map((problem) => (
          <span key={`${problem.path}:${problem.reason}`} className="break-words">
            {PROBLEM_REASON_COPY[problem.reason]}
            <span className="ms-1 font-mono text-xs">{problem.path}</span>
          </span>
        ))}
      </AlertDescription>
    </Alert>
  );
}

function isTagged(error: unknown, tag: string): boolean {
  return typeof error === "object" && error !== null && "_tag" in error && error._tag === tag;
}

function DocumentSkeleton(props: { readonly sections: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      {Array.from({ length: props.sections }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}

function DocumentError(props: {
  readonly title: string;
  readonly gone: string;
  readonly query: EnvironmentQueryView<WayfinderDocument, unknown>;
}) {
  const isGone = isTagged(props.query.failure, "WayfinderTicketNotFoundError");
  return (
    <Alert variant="error">
      <TriangleAlertIcon />
      <AlertTitle>{isGone ? props.gone : props.title}</AlertTitle>
      {isGone ? null : <AlertDescription>{props.query.error}</AlertDescription>}
      {isGone ? null : (
        <AlertAction>
          <Button size="compact" variant="outline" onClick={props.query.refresh}>
            Retry
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

function SectionMarkdown(props: {
  readonly context: ReadoutContext;
  readonly markdown: string;
  readonly imageBaseDir: string;
}) {
  return (
    <ChatMarkdown
      text={props.markdown}
      cwd={props.context.root}
      imageBaseDir={props.imageBaseDir}
      threadRef={props.context.threadRef}
      workspaceMutationId={null}
    />
  );
}

export function TicketReadout(props: {
  readonly context: ReadoutContext;
  readonly map: WayfinderMapSummary;
  readonly ticket: WayfinderTicketSummary;
  readonly onSelect: (number: number) => void;
  readonly onBack: () => void;
}) {
  const { context, map, ticket } = props;
  const query = useEnvironmentQuery(
    wayfinderTicketDocumentAtom({
      environmentId: context.environmentId,
      input: { cwd: context.cwd, mapSlug: map.slug, number: ticket.number },
    }),
  );
  const ticketsDir = resolvePathLinkTarget(`.plan/maps/${map.slug}/tickets`, context.root);
  return (
    <div className="flex flex-col gap-4 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="compact" variant="ghost" onClick={props.onBack}>
          <ArrowLeft aria-hidden />
          Map overview
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">{ticket.number}</span>
        <StatusBadge status={ticket.status} />
        {ticket.type === null ? null : <Badge variant="outline">{ticket.type}</Badge>}
      </div>
      <h2
        tabIndex={-1}
        {...{ [READOUT_FOCUS_ATTRIBUTE]: "title" }}
        className="text-base font-semibold text-foreground outline-none"
      >
        {ticket.title}
      </h2>
      <WayfinderTicketActions
        environmentId={context.environmentId}
        projectId={context.projectId}
        cwd={context.cwd}
        map={map}
        ticket={ticket}
      />
      <ProblemsAlert problems={ticket.problems} />
      <TicketReferenceRows
        label="Blocked by"
        numbers={ticket.blockedBy}
        map={map}
        onSelect={props.onSelect}
      />
      <TicketReferenceRows
        label="Undermined by"
        numbers={ticket.underminedBy}
        map={map}
        onSelect={props.onSelect}
      />
      {query.error !== null ? (
        <DocumentError
          title="Couldn't read this ticket."
          gone="This ticket file is gone."
          query={query}
        />
      ) : null}
      {query.data === null ? (
        query.error === null ? (
          <DocumentSkeleton sections={ticket.status === "open" ? 2 : 3} />
        ) : null
      ) : (
        query.data.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <SectionLabel>{section.heading}</SectionLabel>
            <SectionMarkdown
              context={context}
              markdown={section.markdown}
              imageBaseDir={ticketsDir}
            />
          </section>
        ))
      )}
      {ticket.assets.length === 0 ? null : (
        <section className="flex flex-col gap-2">
          <SectionLabel>Assets</SectionLabel>
          <SectionMarkdown
            context={context}
            markdown={ticket.assets
              .map((asset) => `- [${asset}](<.plan/maps/${map.slug}/assets/${asset}>)`)
              .join("\n")}
            imageBaseDir={context.root}
          />
        </section>
      )}
    </div>
  );
}

export function MapReadout(props: {
  readonly context: ReadoutContext;
  readonly map: WayfinderMapSummary;
  readonly inWorktree: boolean;
  readonly problems: readonly WayfinderProblem[];
  readonly onSelect: (number: number) => void;
}) {
  const { context, map } = props;
  const query = useEnvironmentQuery(
    wayfinderMapDocumentAtom({
      environmentId: context.environmentId,
      input: { cwd: context.cwd, mapSlug: map.slug },
    }),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setExpanded((state) => ({ ...state, [key]: !state[key] }));
  const mapDir = resolvePathLinkTarget(`.plan/maps/${map.slug}`, context.root);
  const resolved = map.tickets.filter((ticket) => ticket.status === "resolved").length;
  const destination = query.data?.sections.find(
    (section) => section.heading.toLowerCase() === "destination",
  );
  const otherSections = query.data?.sections.filter((section) => section !== destination) ?? [];
  return (
    <div className="flex flex-col gap-4 px-4 py-2">
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p className="tabular-nums">
          {resolved} of {map.tickets.length} resolved · {map.frontier.length} on the frontier
        </p>
        <p className="truncate">
          {props.inWorktree ? "Worktree" : "Project root"} · {tildeRoot(context.root)}
        </p>
      </div>
      <ProblemsAlert problems={props.problems} />
      {query.error !== null ? (
        <DocumentError title="Couldn't read this map." gone="This map is gone." query={query} />
      ) : null}
      {query.data === null ? (
        query.error === null ? (
          <DocumentSkeleton sections={1} />
        ) : null
      ) : destination === undefined ? null : (
        <section className="flex flex-col gap-2">
          <SectionLabel>Destination</SectionLabel>
          <SectionMarkdown
            context={context}
            markdown={destination.markdown}
            imageBaseDir={mapDir}
          />
        </section>
      )}
      <section className="flex flex-col gap-1.5">
        <SectionLabel id="frontier">Frontier</SectionLabel>
        {map.frontier.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">Nothing on the frontier.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {map.frontier.map((number) => {
              const ticket = map.tickets.find((entry) => entry.number === number);
              return (
                <TicketRow key={number} number={number} onSelect={props.onSelect}>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {ticket?.title ?? "not found"}
                  </span>
                  {ticket?.type ? <Badge variant="outline">{ticket.type}</Badge> : null}
                </TicketRow>
              );
            })}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-1.5">
        <CollapsibleSectionHeader
          variant="panel"
          expanded={expanded.tickets === true}
          onClick={() => toggle("tickets")}
        >
          All tickets
        </CollapsibleSectionHeader>
        {expanded.tickets === true ? (
          <ul className="flex flex-col gap-1.5">
            {map.tickets.map((ticket) => (
              <TicketRow key={ticket.number} number={ticket.number} onSelect={props.onSelect}>
                <span className="min-w-0 flex-1 truncate text-foreground">{ticket.title}</span>
                <StatusBadge status={ticket.status} />
              </TicketRow>
            ))}
          </ul>
        ) : null}
      </section>
      {otherSections.map((section) => {
        const key = `section:${section.heading}`;
        return (
          <section key={key} className="flex flex-col gap-1.5">
            <CollapsibleSectionHeader
              variant="panel"
              expanded={expanded[key] === true}
              onClick={() => toggle(key)}
            >
              {section.heading}
            </CollapsibleSectionHeader>
            {expanded[key] === true ? (
              <SectionMarkdown
                context={context}
                markdown={section.markdown}
                imageBaseDir={mapDir}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
