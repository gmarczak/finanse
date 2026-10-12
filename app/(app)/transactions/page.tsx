import { Suspense } from "react";
import { TransactionsScreen } from "@/features/transactions/TransactionsScreen";

export default function TransactionsPage() {
  // Filtry są w adresie (?period=&account=&category=), więc ekran czyta searchParams po stronie klienta
  return (
    <Suspense>
      <TransactionsScreen />
    </Suspense>
  );
}
