"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { savePendingIdea } from "@/lib/ideas/pending";

/** Opens Create with this idea's goal; a new visitor signs up first and lands there after. */
export function MakeOneLikeThis({ goal, className }: { goal: string; className?: string }) {
  return (
    <Link href="/create" className={className} onClick={() => savePendingIdea(goal)}>
      Make one like this <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}
