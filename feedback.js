import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const feedbackSections = [...document.querySelectorAll('.chapter-feedback[data-chapter]')];

if (feedbackSections.length) {
  const config = window.SOLA_FEEDBACK_CONFIG || {};
  const isConfigured =
    typeof config.supabaseUrl === 'string' &&
    /^https:\/\/.+\.supabase\.co\/?$/.test(config.supabaseUrl) &&
    typeof config.supabasePublishableKey === 'string' &&
    config.supabasePublishableKey.length > 20 &&
    !config.supabasePublishableKey.includes('YOUR-');

  const sectionState = new Map();

  const createStatus = (section) => {
    const status = document.createElement('p');
    status.className = 'feedback-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    section.prepend(status);
    return status;
  };

  feedbackSections.forEach((section) => {
    sectionState.set(section.dataset.chapter, {
      section,
      status: createStatus(section),
      buttons: [...section.querySelectorAll('.reaction-button[data-reaction]')],
      form: section.querySelector('.comment-form'),
      list: section.querySelector('.comment-list'),
      currentReaction: ''
    });
  });

  const setStatus = (state, message = '', type = '') => {
    state.status.textContent = message;
    state.status.dataset.state = type;
  };

  const setBusy = (state, busy) => {
    state.section.setAttribute('aria-busy', String(busy));
    state.buttons.forEach((button) => {
      button.disabled = busy;
    });
    if (state.form) {
      [...state.form.elements].forEach((control) => {
        control.disabled = busy;
      });
    }
  };

  const renderReactions = (state, rows, userId) => {
    const counts = { like: 0, dislike: 0 };
    let currentReaction = '';

    rows.forEach((row) => {
      if (row.reaction === 'like' || row.reaction === 'dislike') {
        counts[row.reaction] += 1;
      }
      if (row.user_id === userId) currentReaction = row.reaction;
    });

    state.currentReaction = currentReaction;
    state.buttons.forEach((button) => {
      const reaction = button.dataset.reaction;
      button.setAttribute('aria-pressed', String(reaction === currentReaction));
      const count = button.querySelector('.reaction-count');
      if (count) count.textContent = String(counts[reaction] || 0);
    });
  };

  const renderComments = (state, comments) => {
    if (!state.list) return;
    state.list.replaceChildren();

    if (!comments.length) {
      const empty = document.createElement('p');
      empty.className = 'comment-empty';
      empty.textContent = 'No comments yet.';
      state.list.append(empty);
      return;
    }

    comments.forEach((comment) => {
      const article = document.createElement('article');
      article.className = 'reader-comment';

      const header = document.createElement('div');
      header.className = 'reader-comment-header';

      const name = document.createElement('span');
      name.className = 'reader-comment-name';
      name.textContent = comment.display_name || 'Anonymous';

      const time = document.createElement('time');
      time.className = 'reader-comment-time';
      time.dateTime = comment.created_at;
      const parsedDate = new Date(comment.created_at);
      time.textContent = Number.isNaN(parsedDate.getTime())
        ? ''
        : parsedDate.toLocaleString();

      const body = document.createElement('p');
      body.className = 'reader-comment-body';
      body.textContent = comment.body;

      header.append(name, time);
      article.append(header, body);
      state.list.append(article);
    });
  };

  if (!isConfigured) {
    feedbackSections.forEach((section) => {
      const state = sectionState.get(section.dataset.chapter);
      setStatus(
        state,
        'Shared feedback is not configured yet. Add your Supabase project details to feedback-config.js.',
        'error'
      );
      setBusy(state, true);
    });
  } else {
    const supabase = createClient(
      config.supabaseUrl.replace(/\/$/, ''),
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      }
    );

    let currentUser = null;
    const chapterIds = [...sectionState.keys()];

    const ensureAnonymousUser = async () => {
      if (currentUser) return currentUser;

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (sessionData.session?.user) {
        currentUser = sessionData.session.user;
        return currentUser;
      }

      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        throw new Error(
          'Anonymous feedback sign-in failed. Enable Anonymous Sign-Ins in your Supabase project.'
        );
      }
      currentUser = data.user;
      return currentUser;
    };

    const loadAllFeedback = async () => {
      feedbackSections.forEach((section) => {
        const state = sectionState.get(section.dataset.chapter);
        setBusy(state, true);
        setStatus(state, 'Loading shared feedback…', 'loading');
      });

      try {
        const user = await ensureAnonymousUser();
        const [reactionResult, commentResult] = await Promise.all([
          supabase
            .from('chapter_reactions')
            .select('chapter_id,user_id,reaction')
            .in('chapter_id', chapterIds),
          supabase
            .from('chapter_comments')
            .select('id,chapter_id,display_name,body,created_at')
            .in('chapter_id', chapterIds)
            .order('created_at', { ascending: false })
            .limit(1000)
        ]);

        if (reactionResult.error) throw reactionResult.error;
        if (commentResult.error) throw commentResult.error;

        chapterIds.forEach((chapterId) => {
          const state = sectionState.get(chapterId);
          const reactions = reactionResult.data.filter((row) => row.chapter_id === chapterId);
          const comments = commentResult.data
            .filter((row) => row.chapter_id === chapterId)
            .slice(0, 200);
          renderReactions(state, reactions, user.id);
          renderComments(state, comments);
          setStatus(state);
        });
      } catch (error) {
        const message = error?.message || 'The shared feedback service is unavailable.';
        feedbackSections.forEach((section) => {
          setStatus(sectionState.get(section.dataset.chapter), message, 'error');
        });
      } finally {
        feedbackSections.forEach((section) => {
          setBusy(sectionState.get(section.dataset.chapter), false);
        });
      }
    };

    feedbackSections.forEach((section) => {
      const chapterId = section.dataset.chapter;
      const state = sectionState.get(chapterId);

      state.buttons.forEach((button) => {
        button.addEventListener('click', async () => {
          setBusy(state, true);
          setStatus(state, 'Saving reaction…', 'loading');

          try {
            const user = await ensureAnonymousUser();
            const selected = button.dataset.reaction;

            if (state.currentReaction === selected) {
              const { error } = await supabase
                .from('chapter_reactions')
                .delete()
                .eq('chapter_id', chapterId)
                .eq('user_id', user.id);
              if (error) throw error;
            } else {
              const { error } = await supabase
                .from('chapter_reactions')
                .upsert(
                  {
                    chapter_id: chapterId,
                    user_id: user.id,
                    reaction: selected,
                    updated_at: new Date().toISOString()
                  },
                  { onConflict: 'chapter_id,user_id' }
                );
              if (error) throw error;
            }

            await loadAllFeedback();
          } catch (error) {
            setStatus(state, error?.message || 'The reaction could not be saved.', 'error');
            setBusy(state, false);
          }
        });
      });

      state.form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(state.form);
        const displayName = String(formData.get('name') || '').trim().slice(0, 80) || 'Anonymous';
        const comment = String(formData.get('comment') || '').trim().slice(0, 1000);
        if (!comment) return;

        setBusy(state, true);
        setStatus(state, 'Posting comment…', 'loading');

        try {
          const user = await ensureAnonymousUser();
          const { error } = await supabase.from('chapter_comments').insert({
            chapter_id: chapterId,
            user_id: user.id,
            display_name: displayName,
            body: comment
          });
          if (error) throw error;

          localStorage.setItem('gcsg:comment-name', displayName === 'Anonymous' ? '' : displayName);
          state.form.reset();
          const nameInput = state.form.querySelector('input[name="name"]');
          if (nameInput) nameInput.value = localStorage.getItem('gcsg:comment-name') || '';
          await loadAllFeedback();
        } catch (error) {
          setStatus(state, error?.message || 'The comment could not be posted.', 'error');
          setBusy(state, false);
        }
      });

      const nameInput = state.form?.querySelector('input[name="name"]');
      if (nameInput) nameInput.value = localStorage.getItem('gcsg:comment-name') || '';
    });

    loadAllFeedback();
  }
}
