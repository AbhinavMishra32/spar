import React from "react";
import { createRoot } from "react-dom/client";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import "./theme.css";

function Harness() {
  const [checked, setChecked] = React.useState("Item 3");

  return (
    <TooltipProvider>
      <div className="flex min-h-screen items-center justify-center gap-4 bg-background p-10">
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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger id="sub-trigger">More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Nested one</DropdownMenuItem>
                <DropdownMenuItem>Nested two</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
          <TooltipContent>A tooltip</TooltipContent>
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
