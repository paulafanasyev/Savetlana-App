import { requireSellerServer } from "@/lib/auth";
import { getSellerNegotiationPolicy } from "@/lib/domains/negotiation-policy";
import { NegotiationPolicyForm } from "./NegotiationPolicyForm";

export const dynamic = "force-dynamic";

export default async function SellerNegotiationPage() {
  const { sellerId } = await requireSellerServer();
  const policy = await getSellerNegotiationPolicy(sellerId);
  return (
    <main className="space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Торг B2B</h1>
        <p className="text-ink-soft">
          Когда покупатель просит Светлану поторговаться за партию, за вас торгуется ваш агент. Здесь вы задаёте, до какой цены он может уступить.
          Ниже этих пределов агент не опустится ни при каких просьбах, а итог торга — только проект КП: без вашего подтверждения ничего не продаётся.
        </p>
      </div>
      <NegotiationPolicyForm initial={policy} />
    </main>
  );
}
