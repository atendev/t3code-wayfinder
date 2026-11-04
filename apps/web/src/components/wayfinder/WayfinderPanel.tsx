import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ScopedThreadRef,
  WayfinderMapSummary,
  WayfinderProblem,
} from "@t3tools/contracts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import { type RightPanelSurface, useRightPanelStore } from "../../rightPanelStore";
import { useFilesystemReadAccess } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { wayfinderSnapshotAtom } from "../../state/wayfinder";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { type Camera, StarMap } from "./starmap/starmap";
import type { StarPalette } from "./starmap/theme";
import type { StarTicket } from "./starmap/types";
import { PROBLEM_REASON_COPY, tildeRoot } from "./wayfinderCopy";
import { resolveWayfinderSelection, sortMaps } from "./wayfinderSelection";

type WayfinderSurface = Extract<RightPanelSurface, { kind: "wayfinder" }>;

// Survives thread switches and tab changes, never a reload.
const rememberedCameras = new Map<string, Camera>();

export function WayfinderPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | null;
  readonly surface: WayfinderSurface;
}) {
  const { cwd } = props;
  const fileAccess = useFilesystemReadAccess(cwd === null ? null : props.threadRef.environmentId);
  if (cwd === null) return <PanelMessage body="This thread has no project folder." />;
  if (fileAccess.isPending) return <PanelMessage spinner body="Checking file access..." />;
  if (!fileAccess.canReadFiles) {
    return <PanelMessage body={fileAccess.error ?? "This connection cannot read host files."} />;
  }
  return (
    <WayfinderMaps
      threadRef={props.threadRef}
      environmentId={props.threadRef.environmentId}
      cwd={cwd}
      surface={props.surface}
    />
  );
}

function WayfinderMaps(props: {
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly surface: WayfinderSurface;
}) {
  const { threadRef } = props;
  const query = useEnvironmentQuery(
    wayfinderSnapshotAtom({ environmentId: props.environmentId, input: { cwd: props.cwd } }),
  );
  const [fitted, setFitted] = useState(true);
  const [starMap, setStarMap] = useState<StarMap | null>(null);
  const snapshot = query.data?.snapshot ?? null;

  if (snapshot === null) {
    if (query.error !== null) {
      return (
        <PanelMessage title="Couldn't read maps" body={query.error}>
          <Button size="compact" variant="outline" onClick={query.refresh}>
            Retry
          </Button>
        </PanelMessage>
      );
    }
    return <PanelMessage spinner body="Loading maps..." />;
  }

  const maps = sortMaps(snapshot.maps);
  if (maps.length === 0) {
    if (snapshot.problems.length === 0) {
      return (
        <PanelMessage
          title="No maps in this checkout"
          body={`Wayfinder reads maps from .plan/maps/ in ${tildeRoot(snapshot.root)}. Ask an agent to chart one with the wayfinder skill.`}
        />
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6">
          <p className="text-sm font-medium text-foreground">No maps could be read</p>
          <ProblemList problems={snapshot.problems} onSelectTicket={null} />
        </div>
      </div>
    );
  }

  const { map, ticketNumber } = resolveWayfinderSelection(maps, props.surface);
  if (map === null) return null;
  const select = (mapSlug: string, number: number | null) =>
    useRightPanelStore
      .getState()
      .setWayfinderSelection(threadRef, { mapSlug, ticketNumber: number });
  const ticketProblems = map.tickets.flatMap((ticket) =>
    ticket.problems.map((problem) => ({ problem, ticketNumber: ticket.number })),
  );
  const problems = [
    ...snapshot.problems.map((problem) => ({ problem, ticketNumber: null })),
    ...map.problems.map((problem) => ({ problem, ticketNumber: null })),
    ...ticketProblems,
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <MapPicker
          maps={maps}
          current={map}
          onPick={(slug) => {
            if (slug !== map.slug) select(slug, null);
          }}
        />
        {fitted || map.tickets.length === 0 ? null : (
          <Button
            size="compact"
            variant="ghost"
            onClick={() => {
              starMap?.fit();
              setFitted(true);
            }}
          >
            Fit
          </Button>
        )}
      </div>
      {problems.length > 0 ? (
        <ProblemsRow problems={problems} onSelectTicket={(number) => select(map.slug, number)} />
      ) : null}
      {map.tickets.length === 0 ? (
        <PanelMessage
          title="This map has no tickets yet"
          body={`Tickets appear as files in .plan/maps/${map.slug}/tickets/.`}
        />
      ) : (
        <StarMapIsland
          key={`${scopedThreadKey(threadRef)}:${map.slug}`}
          cameraKey={`${scopedThreadKey(threadRef)}:${map.slug}`}
          map={map}
          selected={ticketNumber}
          onSelect={(number) => select(map.slug, number)}
          onFittedChange={setFitted}
          onReady={setStarMap}
        />
      )}
      <section aria-label="Readout" className="shrink-0 border-t px-3 py-2">
        <p className="truncate text-sm font-medium text-foreground">{map.title}</p>
      </section>
    </div>
  );
}

function MapPicker(props: {
  readonly maps: readonly WayfinderMapSummary[];
  readonly current: WayfinderMapSummary;
  readonly onPick: (slug: string) => void;
}) {
  if (props.maps.length < 2) {
    return (
      <span className="flex min-h-7 min-w-0 items-center truncate px-1 text-sm font-medium">
        {props.current.title}
      </span>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="compact" variant="ghost" />}
        aria-label={`Map: ${props.current.title}`}
      >
        <span className="truncate">{props.current.title}</span>
        <ChevronDown aria-hidden />
      </MenuTrigger>
      <MenuPopup align="start">
        <div className="flex flex-col gap-1.5">
          {props.maps.map((map) => {
            const resolved = map.tickets.filter((ticket) => ticket.status === "resolved").length;
            return (
              <MenuItem key={map.slug} onClick={() => props.onPick(map.slug)}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{map.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {map.slug} · {resolved} of {map.tickets.length} resolved
                  </span>
                </span>
              </MenuItem>
            );
          })}
        </div>
      </MenuPopup>
    </Menu>
  );
}

interface ListedProblem {
  readonly problem: WayfinderProblem;
  readonly ticketNumber: number | null;
}

function ProblemsRow(props: {
  readonly problems: readonly ListedProblem[];
  readonly onSelectTicket: (ticketNumber: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = props.problems.length;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="flex max-h-[40%] shrink-0 flex-col border-b">
      <Button
        size="compact"
        variant="ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="justify-start"
      >
        <Chevron aria-hidden />
        {count} {count === 1 ? "problem" : "problems"}
      </Button>
      {expanded ? (
        <ProblemList problems={props.problems} onSelectTicket={props.onSelectTicket} />
      ) : null}
    </div>
  );
}

function ProblemList(props: {
  readonly problems: readonly (ListedProblem | WayfinderProblem)[];
  readonly onSelectTicket: ((ticketNumber: number) => void) | null;
}) {
  return (
    <ul className="min-h-0 overflow-y-auto px-3 pb-2 text-sm">
      {props.problems.map((entry) => {
        const { problem, ticketNumber } =
          "problem" in entry ? entry : { problem: entry, ticketNumber: null };
        const content = (
          <>
            <span className="font-mono text-xs text-foreground">{problem.path}</span>{" "}
            <span className="text-muted-foreground">{PROBLEM_REASON_COPY[problem.reason]}</span>
          </>
        );
        const onSelectTicket = props.onSelectTicket;
        return (
          <li key={`${problem.path}:${problem.reason}`} className="py-1">
            {ticketNumber !== null && onSelectTicket !== null ? (
              <button
                type="button"
                className="min-h-7 text-start hover:underline"
                onClick={() => onSelectTicket(ticketNumber)}
              >
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PanelMessage(props: {
  readonly title?: string;
  readonly body: string;
  readonly spinner?: boolean;
  readonly children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      {props.spinner ? <Spinner /> : null}
      {props.title ? <p className="text-sm font-medium text-foreground">{props.title}</p> : null}
      <p className="max-w-80 text-sm text-muted-foreground">{props.body}</p>
      {props.children}
    </div>
  );
}

function starTickets(map: WayfinderMapSummary): StarTicket[] {
  return map.tickets.map((ticket) => ({
    num: ticket.number,
    title: ticket.title,
    type: ticket.type ?? "",
    status: ticket.status,
    blockedBy: ticket.blockedBy,
    frontier: ticket.frontier,
  }));
}

const TOKEN_FIELDS = {
  background: "--card",
  frontier: "--info-foreground",
  claimed: "--warning-foreground",
  resolved: "--success-foreground",
  blocked: "--muted-foreground",
  edge: "--foreground",
  edgeMuted: "--muted-foreground",
  labelStroke: "--card",
} as const;

// Tokens resolve to oklch() and color-mix() text; a probe's computed colour is canvas-ready.
function readPalette(
  host: HTMLElement,
  scheme: "light" | "dark",
  highContrast: boolean,
): StarPalette {
  const probe = document.createElement("span");
  probe.style.display = "none";
  host.appendChild(probe);
  const read = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const colors = Object.fromEntries(
    Object.entries(TOKEN_FIELDS).map(([field, token]) => [field, read(token)]),
  ) as Record<keyof typeof TOKEN_FIELDS, string>;
  const label = read(highContrast ? "--foreground" : "--muted-foreground");
  probe.remove();
  return { ...colors, label, scheme, highContrast };
}

function StarMapIsland(props: {
  readonly cameraKey: string;
  readonly map: WayfinderMapSummary;
  readonly selected: number | null;
  readonly onSelect: (num: number) => void;
  readonly onFittedChange: (fitted: boolean) => void;
  readonly onReady: (map: StarMap | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<StarMap | null>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const highContrast = useMediaQuery("(prefers-contrast: more)");
  const { resolvedTheme, themeHalves } = useTheme();
  const tickets = starTickets(props.map);
  const emitSelect = useEffectEvent((num: number) => props.onSelect(num));
  const reportFitted = useEffectEvent((fitted: boolean) => props.onFittedChange(fitted));
  const reportReady = useEffectEvent((map: StarMap | null) => props.onReady(map));
  const mountWith = useEffectEvent((map: StarMap, host: HTMLElement) => {
    map.mount(host);
    map.setReducedMotion(reducedMotion);
    map.setPalette(readPalette(host, resolvedTheme, highContrast));
    map.setModel(tickets);
    map.select(props.selected);
    const remembered = rememberedCameras.get(props.cameraKey);
    if (remembered && !remembered.fitted) map.restoreCamera(remembered);
    else map.fit();
    return props.cameraKey;
  });
  const syncFitted = () => {
    const map = mapRef.current;
    if (map) props.onFittedChange(map.camera().fitted);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mounts the imperative canvas island and remembers its camera on unmount
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const map = new StarMap();
    mapRef.current = map;
    map.onSelect((num) => {
      if (num !== null) emitSelect(num);
    });
    const cameraKey = mountWith(map, host);
    reportFitted(map.camera().fitted);
    reportReady(map);
    const onGestureEnd = () => reportFitted(map.camera().fitted);
    host.addEventListener("gestureend", onGestureEnd);
    return () => {
      host.removeEventListener("gestureend", onGestureEnd);
      rememberedCameras.set(cameraKey, map.camera());
      reportReady(null);
      map.destroy();
      mapRef.current = null;
    };
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds the media query into the island
  useLayoutEffect(() => {
    mapRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- app themes redefine tokens, so the canvas re-reads them on any theme or contrast change
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host) mapRef.current?.setPalette(readPalette(host, resolvedTheme, highContrast));
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- app theme halves swap the tokens the palette reads
  }, [resolvedTheme, themeHalves, highContrast]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes each snapshot into the island; an unchanged model is a no-op there
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setModel(tickets);
    reportFitted(map.camera().fitted);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores remembered selection; select() never emits, so this cannot loop
  useLayoutEffect(() => {
    mapRef.current?.select(props.selected);
  }, [props.selected]);

  const frontier = props.map.frontier.length;
  return (
    <div
      ref={hostRef}
      role="img"
      tabIndex={0}
      aria-label={`${props.map.title}, ${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}, ${frontier} on the frontier`}
      onPointerUp={syncFitted}
      onPointerCancel={syncFitted}
      onWheel={syncFitted}
      className="relative min-h-0 flex-1 overflow-hidden bg-card [&>canvas.drag]:cursor-grabbing [&>canvas]:block [&>canvas]:cursor-grab [&>canvas]:touch-none"
    />
  );
}
