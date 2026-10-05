import { JobForm } from '@/components/JobForm';
import { Card, CardContent } from '@/components/ui/card';

export default function NewJobPage() {
  return (
    <>
      <Card><CardContent className="pt-5"><JobForm /></CardContent></Card>
    </>
  );
}
