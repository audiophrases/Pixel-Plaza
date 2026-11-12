import type { BoardView, QuestView } from '../../shared/campaign';
import type { WarmupView } from '../../shared/warmup';

export type NextStep = { en: string; ca: string };
const step = (en: string, ca: string): NextStep => ({ en, ca });

// Use only progress and names already visible to this student, never hidden answers.
export function nextStep({ quest, board, warmup, online, choosingName, name }: {
  quest: QuestView | null; board: BoardView | null; warmup: WarmupView | null;
  online: boolean; choosingName: boolean; name?: string;
}): NextStep {
  if (!online) return step('Wait a moment. We are reconnecting.', 'Espera un moment. Ens estem reconnectant.');
  if (choosingName) return step('Choose your name first.', 'Primer, tria el teu nom.');
  const active = board?.board.find(item => item.state === 'active' && !item.ended);
  const mission = quest?.status !== 'campaign_complete' ? quest : null;
  const incoming = mission?.interviews?.find(item => item.incoming && !['approved', 'pending'].includes(item.answerStatus ?? ''));
  if (incoming) return step(`Reply to ${incoming.name} and share a clue in your Journal.`, `Respon a ${incoming.name} i comparteix una pista al diari.`);
  const objective = active ?? mission?.objectives.find(item => !item.done && !item.optional);
  if (objective) {
    if (objective.report?.submitted && objective.report.check) return step('Wait a moment. Your report is being checked.', 'Espera un moment. S’està revisant el teu informe.');
    if (active?.group?.state === 'open') return step('Wait for classmates to join your group.', 'Espera que els companys s’uneixin al teu grup.');
    const conversation = objective.conversation;
    if (conversation && conversation.completed < conversation.required) {
      const records = mission?.interviews?.filter(item => !item.incoming && item.objective === objective.id) ?? [];
      const witness = conversation.witnesses.find(person => !records.some(record => record.name === person.name && ['approved', 'pending'].includes(record.questionStatus)));
      if (witness) return step(`Ask ${witness.name} a question and share a clue in your Journal.`, `Fes una pregunta a ${witness.name} i comparteix una pista al diari.`);
      return step('Wait for a classmate’s reply. Check your Journal.', 'Espera la resposta d’un company. Mira el diari.');
    }
    if (objective.report?.check?.status === 'revise') return step('Read the hint in your Journal. Fix your report and send it again.', 'Llegeix el consell del diari. Corregeix l’informe i torna’l a enviar.');
    const partners = active?.partner?.name ?? active?.group?.members.filter(member => member !== name).join(', ');
    if (partners && !conversation && !objective.report?.text) return step(
      `Talk to ${partners} about the task. Then ${objective.kind === 'report' ? 'write and send your report' : 'send your answer'} in your Journal.`,
      `Parla amb ${partners} sobre la tasca. Després, ${objective.kind === 'report' ? 'escriu i envia l’informe' : 'envia la resposta'} al diari.`);
    return objective.kind === 'report'
      ? step('Write and send your report in your Journal to finish the task.', 'Escriu i envia l’informe al diari per acabar la tasca.')
      : step('Read the question in your Journal. Write and send your answer.', 'Llegeix la pregunta del diari. Escriu i envia la resposta.');
  }
  if (warmup?.task) return step('Do the warm-up task. Talk to classmates, then send your answer in the warm-up panel.', 'Fes la tasca d’escalfament. Parla amb els companys i envia la resposta al panell d’escalfament.');
  if (board?.studentChoice || board?.board.some(item => item.state === 'available' && !item.ended)) return step('Choose a quest in your Journal.', 'Tria una missió al diari.');
  return step('You have no task to do right now. Ask your teacher what is next.', 'Ara no tens cap tasca pendent. Pregunta al professor què has de fer després.');
}
