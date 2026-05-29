'use client';

import InstructionForm from '@/components/InstructionForm';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';
import { VIEWER_ONLY } from '@/lib/appMode';

export default function NewInstructionPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return <InstructionForm />;
}
