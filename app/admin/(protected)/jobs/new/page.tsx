import { JobForm } from '@/components/JobForm';
import { Card, CardContent } from '@/components/ui/card';

export default function NewJobPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">New job</h1>
      <Card><CardContent className="pt-5"><JobForm /></CardContent></Card>
    </>
  );
}
