"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriceSourceBadge } from "./price-source-badge";
import { formatCr, formatPct } from "@/lib/utils/format";
import type { HoldingLiveView } from "@/lib/aum/types";

type SortKey = "liveMarketValueCr" | "reportedMarketValueCr" | "weightPct" | "companyName";

export function HoldingsTable({ holdings }: { holdings: HoldingLiveView[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("liveMarketValueCr");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    const list = [...holdings];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [holdings, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Company" active={sortKey === "companyName"} onClick={() => toggleSort("companyName")} />
            <TableHead>Sector</TableHead>
            <TableHead>Cap</TableHead>
            <SortableHead
              label="Reported Value"
              active={sortKey === "reportedMarketValueCr"}
              onClick={() => toggleSort("reportedMarketValueCr")}
              align="right"
            />
            <SortableHead
              label="Live Value"
              active={sortKey === "liveMarketValueCr"}
              onClick={() => toggleSort("liveMarketValueCr")}
              align="right"
            />
            <SortableHead
              label="Weight"
              active={sortKey === "weightPct"}
              onClick={() => toggleSort("weightPct")}
              align="right"
            />
            <TableHead>Price</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="font-medium">{h.companyName}</TableCell>
              <TableCell className="text-muted-foreground">{h.sector}</TableCell>
              <TableCell className="text-muted-foreground">{h.mcapClassification ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCr(h.reportedMarketValueCr)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCr(h.liveMarketValueCr)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPct(h.weightPct)}</TableCell>
              <TableCell>
                <PriceSourceBadge source={h.priceSource} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  label,
  active,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: "right";
}) {
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={onClick}
        className={`hover:text-foreground ${active ? "text-foreground font-medium" : ""}`}
      >
        {label}
      </button>
    </TableHead>
  );
}
