"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
export function GuestOrderAccess({ id }: { id: string }) {
  const [message, setMessage] = useState(
    "A valid private order link is required. Email recovery is not connected yet.",
  );
  const router = useRouter();
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("access");
    if (!token) return;
    history.replaceState(null, "", location.pathname);
    void api("guest-order", {
      method: "POST",
      body: JSON.stringify({ id, token }),
    })
      .then(() => router.refresh())
      .catch(() =>
        setMessage(
          "Order link is invalid or expired. No payment or generation was started.",
        ),
      );
  }, [id, router]);
  return <p role="status">{message}</p>;
}
