import { useState } from 'react';
import { AuthTokenInput } from './app/components/AuthTokenInput';
import { ConversationHeader } from './app/components/ConversationHeader';
import { ConversationHistory } from './app/components/ConversationHistory';
import { PromptComposer } from './app/components/PromptComposer';
import { StorefrontSearchBox } from './app/components/StorefrontSearchBox';
import { TranscriptPanel } from './app/components/TranscriptPanel';
import type { StorageHealth } from './app/conversation.interfaces';
// Importing the history store hydrates the conversation store from
// localStorage and wires up per-turn persistence of the saved list.
import { conversationHistoryStore } from './app/services/conversation-history-store';
import { conversationStore } from './app/services/conversation-store';
import { feedbackSink } from './app/services/feedback-sink';
import { useStoreState } from './app/store';

export default function App() {
  const conversation = useStoreState(conversationStore);
  const history = useStoreState(conversationHistoryStore);
  const [searchExpanded, setSearchExpanded] = useState(false);
  // The canned conversation starters (empty-state chips + popular-queries
  // grid) describe the mock catalog, so they only render in mock mode.
  const showStarters = conversation.agentMode !== 'live';

  return (
    <main className="shell">
      <header className={`storefront-header${searchExpanded ? ' expanded' : ''}`}>
        <div className="storefront-brand">
          <span className="storefront-brand-name">Conversational Discovery</span>
          <span className="storefront-brand-sub">Commerce agent reference app</span>
        </div>
        <StorefrontSearchBox
          disabled={conversation.busy}
          showPopularQueries={showStarters}
          onSubmitGenerative={(prompt) => conversationStore.submitPrompt(prompt)}
          onExpandedChange={setSearchExpanded}
        />
        <div className="storefront-header-controls">
          {conversation.agentMode === 'live' && <AuthTokenInput />}
          <ConversationHeader
            threadId={conversation.threadId}
            conversationId={conversation.conversationId}
            status={conversation.status}
            historyCount={conversation.messages.length}
            agentMode={conversation.agentMode}
            busy={conversation.busy}
            onAgentModeChange={(enabled) => conversationStore.toggleAgentMode(enabled)}
          />
        </div>
      </header>

      {history.storageHealth !== 'ready' && (
        <div className="storage-warning" role="status">
          {storageWarningText(history.storageHealth)}
        </div>
      )}

      <section className="workspace">
        <div className="workspace-controls">
          <ConversationHistory />
        </div>
        <article className="panel transcript-panel">
          <TranscriptPanel
            threadId={conversation.threadId}
            messages={conversation.messages}
            reasoningText={conversation.reasoningText}
            toolActivity={conversation.toolActivity}
            surfaces={conversation.surfaces}
            completedTurns={conversation.completedTurns}
            busy={conversation.busy}
            answerFeedbackByTurnId={conversation.answerFeedbackByTurnId}
            sessionFeedback={conversation.sessionFeedback}
            turnTelemetryByTurnId={conversation.turnTelemetryByTurnId}
            showQuickActions={showStarters}
            // Reset routes through the history store so the active id is
            // cleared — a later prompt must never overwrite the prior
            // saved conversation (see conversation-history-store.ts).
            onResetConversation={() => conversationHistoryStore.startNew()}
            onQuickAction={(action) => conversationStore.useQuickAction(action)}
            onSubmitFeedback={(submission) => feedbackSink.submit(submission)}
          />
        </article>
      </section>

      <div className="composer-bar">
        <PromptComposer
          draft={conversation.draft}
          busy={conversation.busy}
          status={conversation.status}
          onDraftChange={(value) => conversationStore.setDraft(value)}
          onSubmitPrompt={() => conversationStore.submitPrompt()}
        />
      </div>
    </main>
  );
}

function storageWarningText(health: StorageHealth): string {
  switch (health) {
    case 'quota_exceeded':
      return 'Browser storage is full — recent conversations and feedback are not being saved. Export your conversations, then delete old ones to free space.';
    case 'unavailable':
      return 'Browser storage is unavailable — conversations and feedback will not survive a reload. Exports still work from memory.';
    default:
      return 'Saving to browser storage failed — recent changes may not persist. Exports still work from memory.';
  }
}
