import { requireUser } from "@/lib/auth";
import { FactoryForm } from "@/components/factory-form";
import { PageHeader } from "@/components/page";
export default async function FactoryPage(){
  const user=await requireUser();
  const configured=user.role==="OWNER"&&user.accountId===process.env.MYFACTORY_RELAY_ACCOUNT_ID&&!!process.env.MYFACTORY_CLIENT_TOKEN;
  return <><PageHeader eyebrow="Connected apps" title="MyFactory" description="Send bounded work to your local software factory and follow its verified receipt."/>
    <p className="subtle">Repository: {process.env.MYFACTORY_REPOSITORY??"Not configured"}. Sending work creates intake. Coding attempts and publication remain separate decisions on your Mac.</p>
    <FactoryForm configured={configured}/></>;
}
