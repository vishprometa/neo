/**
 * Question tool for Neo coding assistant
 * Allows the agent to ask the user structured questions
 * Ported from erpai-cli vendor tools
 *
 * In the desktop app, questions are surfaced via the agent event system.
 * The agent emits a 'question' event and the UI presents a dialog.
 */
import { z } from 'zod';
import { defineTool } from '../tool';

const QuestionOption = z.object({
  value: z.string().describe('The value returned when this option is selected'),
  label: z.string().describe('Display label for the option'),
});

const QuestionInfo = z.object({
  question: z.string().describe('The question text to display'),
  options: z.array(QuestionOption).min(2).describe('Answer options'),
  allowMultiple: z.boolean().optional().describe('Allow selecting multiple options'),
});

export const QuestionTool = defineTool('question', {
  description: `Ask the user one or more structured multiple-choice questions.

Use this tool when you need to:
- Get the user's preference between several valid approaches
- Confirm before making a potentially risky change
- Gather specific information needed to proceed

Each question must have at least 2 options. The user will see the questions
in a dialog and can select their answers.

Note: For simple yes/no confirmations, prefer just asking in your text response.
Use this tool for structured multi-option questions.`,
  parameters: z.object({
    questions: z.array(QuestionInfo).describe('Questions to ask the user'),
  }),
  async execute(params) {
    // In the desktop app, this would emit an event for the UI to display a dialog.
    // For now, we format the questions and ask the user to respond in chat.
    const formatted = params.questions.map((q, i) => {
      const options = q.options.map((o) => `  - ${o.label} (${o.value})`).join('\n');
      return `Q${i + 1}: ${q.question}\nOptions:\n${options}`;
    }).join('\n\n');

    return {
      title: `Asked ${params.questions.length} question(s)`,
      output: `I need your input on the following:\n\n${formatted}\n\nPlease reply with your choices and I will continue.`,
      metadata: {
        questionCount: params.questions.length,
        questions: params.questions,
      },
    };
  },
});
