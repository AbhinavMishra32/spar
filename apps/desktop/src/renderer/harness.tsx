import React from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown } from "lucide-react";
import { MotionConfig } from "motion/react";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipKeys, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextUsageIndicator } from "@/components/agent/ContextUsage";
import "./theme.css";

function Harness() {
  const [checked, setChecked] = React.useState("Item 3");
  const [effort, setEffort] = React.useState("High");
  const [fast, setFast] = React.useState(false);

  return (
    <TooltipProvider>
      <div className="flex min-h-screen items-center justify-center gap-4 bg-background p-10">
        {/* The composer pair, so the rest-to-hover spacing can be measured
            rather than eyeballed. */}
        <div className="flex min-w-0 items-center gap-0.5 px-0.5" id="composer-pair">
          {/* The context ring, held at a fixed reading so the popover can be
              measured against Aside's own. */}
          <ContextUsageIndicator
            subscription={{ id: "openai-codex", name: "ChatGPT" }}
            usage={{ usedTokens: 44_000, totalTokens: 272_000 }}
            windows={[
              { kind: "five-hour", usedPercent: 0, resetsAt: null },
              { kind: "weekly", usedPercent: 56, resetsAt: null },
            ]}
          />
          <button
            className="group inline-flex h-7 max-w-[9rem] shrink-0 items-center gap-1.5 rounded-full py-0 pr-0 pl-0 text-ui-sm font-medium text-foreground/90 transition-[padding,background-color,color] duration-150 outline-none hover:bg-[var(--color-background-elevated-secondary)] hover:pr-2 hover:pl-1.5 hover:text-foreground aria-expanded:bg-[var(--color-background-elevated-secondary)] aria-expanded:pr-2 aria-expanded:pl-1.5 aria-expanded:text-foreground"
            id="pair-model"
            type="button"
          >
            <span className="size-4 shrink-0 rounded-full bg-foreground/25" />
            <span className="truncate">Poolside: Laguna S 2.1 (fast)</span>
            <ChevronDown className="size-3.5 w-0 shrink-0 opacity-0 transition-[width,opacity] duration-150 group-hover:w-3.5 group-hover:opacity-50 group-aria-expanded:w-3.5 group-aria-expanded:opacity-50" />
          </button>
          <button
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-0 text-ui-sm font-medium text-muted-foreground transition-[padding,background-color,color] duration-150 outline-none hover:bg-[var(--color-background-elevated-secondary)] hover:px-2 hover:text-foreground aria-expanded:bg-[var(--color-background-elevated-secondary)] aria-expanded:px-2 aria-expanded:text-foreground"
            id="pair-effort"
            type="button"
          >
            <span className="truncate">High</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-50" />
          </button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger id="effort-trigger" className="rounded-md border px-3 py-1.5 text-sm">
            {effort}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-[9rem]">
            <DropdownMenuLabel>Effort</DropdownMenuLabel>
            {["Off", "Low", "Medium", "High", "Extra High"].map((label) => (
              <DropdownMenuCheckItem checked={effort === label} key={label} onSelect={() => setEffort(label)}>
                <span className="flex-1 truncate">{label}</span>
              </DropdownMenuCheckItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Options</DropdownMenuLabel>
            <DropdownMenuItem
              aria-checked={fast}
              onSelect={(event) => { event.preventDefault(); setFast((value) => !value); }}
              role="menuitemcheckbox"
            >
              <span className="flex-1 truncate">Fast mode</span>
              <Switch checked={fast} className="pointer-events-none ml-auto" onCheckedChange={setFast} size="sm" tabIndex={-1} />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger id="menu-trigger" className="rounded-md border px-3 py-1.5 text-sm">
            Open menu
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[14rem]">
            <DropdownMenuLabel>Section</DropdownMenuLabel>
            {Array.from({ length: 14 }, (_, i) => (
              <DropdownMenuCheckItem checked={checked === `Item ${i}`} key={i} onSelect={() => setChecked(`Item ${i}`)}>
                <span className="flex-1">Item {i}</span>
              </DropdownMenuCheckItem>
            ))}
            <DropdownMenuSeparator />
            {/* Three of them, because the thing worth testing is moving between
                sub triggers — one submenu can never show the stall. */}
            {["More", "Providers", "Elsewhere"].map((label, index) => (
              <DropdownMenuSub key={label}>
                <DropdownMenuSubTrigger id={index === 0 ? "sub-trigger" : `sub-trigger-${index}`}>
                  {label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {Array.from({ length: 6 }, (_, row) => (
                    <DropdownMenuItem key={row}>{label} {row}</DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
            <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog>
          <DialogTrigger id="dialog-trigger" className="rounded-md border px-3 py-1.5 text-sm">
            Open modal
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>A modal</DialogTitle>
              <DialogDescription>It should spring in and fade out.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>

        <Tooltip>
          <TooltipTrigger id="tooltip-trigger" className="rounded-md border px-3 py-1.5 text-sm">
            Hover me
          </TooltipTrigger>
          <TooltipContent>
            Model
            <TooltipKeys>⇧⌘M</TooltipKeys>
          </TooltipContent>
        </Tooltip>

        <HoverCard>
          <HoverCardTrigger id="hovercard-trigger" className="rounded-md border px-3 py-1.5 text-sm">
            Hover card
          </HoverCardTrigger>
          <HoverCardContent>Some longer content that lives in a hover card.</HoverCardContent>
        </HoverCard>
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <Harness />
    </MotionConfig>
  </React.StrictMode>,
);
