"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import WalkInForm from "../../_components/WalkInForm";

export default function EditWalkInPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!id) {
        setError("A walk-in record ID is required.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/staff/walk-ins/${id}`, {
          credentials: "include",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          record?: Record<string, unknown>;
        };

        if (!response.ok || !payload.success || !payload.record) {
          throw new Error(payload.error || "Could not load the walk-in record.");
        }

        if (active) setRecord(payload.record);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load the walk-in record."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-2xl border border-emerald-200 bg-white/90 p-8 text-emerald-800">
        <Loader2 size={26} className="animate-spin" />
        <p className="text-sm font-semibold">Loading walk-in record...</p>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="space-y-4">
        <Link
          href="/staff/dashboard/walk-ins"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
        >
          <ArrowLeft size={14} />
          Back to Manage Walk-ins
        </Link>
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p>{error || "The walk-in record could not be found."}</p>
        </div>
      </div>
    );
  }

  return <WalkInForm mode="edit" recordId={id} initialRecord={record} />;
}
