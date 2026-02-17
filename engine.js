(async function () {
    var app = document.getElementById('app');

    // Disable transitions/animations during pinch zoom
    document.addEventListener('touchstart', function (e) {
        if (e.touches.length >= 2) document.documentElement.classList.add('pinching');
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
        if (e.touches.length < 2) document.documentElement.classList.remove('pinching');
    }, { passive: true });
    document.addEventListener('touchcancel', function () {
        document.documentElement.classList.remove('pinching');
    }, { passive: true });

    var DEFAULT_SLUG = 'quiz-001-sample';
    var params = new URLSearchParams(window.location.search);
    var quizParam = params.get('quiz');
    var quizSlug;
    var quizNumber = null;

    if (quizParam && /^\d+$/.test(quizParam) && parseInt(quizParam, 10) > 0) {
        quizNumber = parseInt(quizParam, 10);
        quizSlug = 'quiz-' + String(quizNumber).padStart(3, '0');
    } else {
        quizSlug = quizParam || DEFAULT_SLUG;
    }

    var V = Date.now();

    function showLoadError(num) {
        app.innerHTML = '';
        app.style.textAlign = 'center';
        app.style.direction = 'rtl';
        var msg = document.createElement('p');
        msg.style.cssText = 'font-size:1.2rem;margin-bottom:24px;color:#333;';
        msg.textContent = 'לא נמצא חידון מספר ' + num + '.';
        app.appendChild(msg);
        var btn = document.createElement('button');
        btn.textContent = 'לחידון הראשי';
        btn.style.cssText = 'font-size:1.08rem;font-weight:500;padding:12px 36px;border:none;border-radius:6px;cursor:pointer;background-color:#6b8fb3;color:#fff;';
        btn.addEventListener('click', function () {
            window.location.href = window.location.pathname;
        });
        app.appendChild(btn);
    }

    var sysUrl = 'system_texts.json?v=' + V;
    var quizUrl = 'quizzes-ready/' + quizSlug + '.json?v=' + V;
    var systemTexts, quizData;
    try {
        var responses = await Promise.all([
            fetch(sysUrl),
            fetch(quizUrl)
        ]);
        if (!responses[0].ok) {
            throw new Error('system_texts: HTTP ' + responses[0].status);
        }
        if (!responses[1].ok) {
            if (quizNumber !== null) { showLoadError(quizNumber); return; }
            throw new Error('quiz JSON: HTTP ' + responses[1].status);
        }
        try { systemTexts = await responses[0].json(); }
        catch (pe) { throw new Error('system_texts parse: ' + pe.message); }
        try { quizData = await responses[1].json(); }
        catch (pe) { throw new Error('quiz JSON parse (' + quizUrl + '): ' + pe.message); }
    } catch (e) {
        if (quizNumber !== null) { showLoadError(quizNumber); return; }
        app.textContent = 'שגיאה בטעינת הנתונים.';
        return;
    }

    // Build full title dynamically
    var quizLine = 'חידון (קצר) ' + quizData.quiz_number;
    var fullTitle = quizData.series_title + ' \u2013 ' + quizLine;

    document.title = fullTitle;
    var ogMeta = document.querySelector('meta[property="og:title"]');
    if (!ogMeta) {
        ogMeta = document.createElement('meta');
        ogMeta.setAttribute('property', 'og:title');
        document.head.appendChild(ogMeta);
    }
    ogMeta.setAttribute('content', fullTitle);

    var currentQuestionIndex = 0;
    var score = 0;
    var selectedAnswers = new Set();
    var confirmInProgress = false;
    var lastProgressPct = 0;

    // Global UI state
    var scrollHintEl = null;
    var screenListeners = [];
    var rafId = 0;

    var lastPicked = {};

    function getRandomItem(arr, category) {
        if (!arr || arr.length === 0) return '';
        if (arr.length === 1) return arr[0];
        var last = category ? lastPicked[category] : undefined;
        var pick;
        for (var attempts = 0; attempts < 10; attempts++) {
            pick = arr[Math.floor(Math.random() * arr.length)];
            if (pick !== last) break;
        }
        if (category) lastPicked[category] = pick;
        return pick;
    }

    // ── Scrollability check ──

    function isPageScrollable() {
        return document.documentElement.scrollHeight > window.innerHeight;
    }

    // ── Sticky button logic ──

    function updateStickyState() {
        var btn = app.querySelector('.confirm-button, .next-button');
        if (!btn) return;

        var screen = app.querySelector('.screen');
        var scrollable = isPageScrollable();

        if (scrollable) {
            btn.classList.add('is-sticky');
            if (screen) screen.classList.add('has-sticky-btn');
        } else {
            btn.classList.remove('is-sticky');
            if (screen) screen.classList.remove('has-sticky-btn');
        }
    }

    // ── Scroll hint (Model A) ──

    function updateScrollHint() {
        if (!scrollHintEl) return;
        if (isPageScrollable() && window.scrollY < 2) {
            scrollHintEl.classList.remove('hidden');
        } else {
            if (!scrollHintEl.classList.contains('hidden')) {
                scrollHintEl.classList.add('hidden');
            }
        }
    }

    // ── Unified listener setup / teardown ──

    function cleanupScreenListeners() {
        if (scrollHintEl && scrollHintEl.parentNode) {
            scrollHintEl.parentNode.removeChild(scrollHintEl);
        }
        scrollHintEl = null;
        for (var i = 0; i < screenListeners.length; i++) {
            window.removeEventListener(screenListeners[i].type, screenListeners[i].fn);
        }
        screenListeners = [];
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
    }

    function scheduleUpdate() {
        if (rafId) return;
        rafId = requestAnimationFrame(function () {
            rafId = 0;
            updateStickyState();
            updateScrollHint();
        });
    }

    function setupScreenBehavior() {
        cleanupScreenListeners();

        // Create scroll hint element
        scrollHintEl = document.createElement('button');
        scrollHintEl.className = 'scroll-hint hidden';
        scrollHintEl.setAttribute('aria-label', 'גלול למטה');
        scrollHintEl.textContent = '';
        document.body.appendChild(scrollHintEl);

        scrollHintEl.addEventListener('click', function () {
            window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });
        });

        // Single scroll listener
        var onScroll = function () {
            scheduleUpdate();
        };
        var onResize = function () {
            scheduleUpdate();
        };
        var onOrientation = function () {
            setTimeout(scheduleUpdate, 200);
        };

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onOrientation);
        screenListeners.push({ type: 'scroll', fn: onScroll });
        screenListeners.push({ type: 'resize', fn: onResize });
        screenListeners.push({ type: 'orientationchange', fn: onOrientation });

        // Initial checks after layout settles
        window.scrollTo(0, 0);
        setTimeout(scheduleUpdate, 50);
        setTimeout(scheduleUpdate, 300);

        // Recheck after images load
        var images = document.querySelectorAll('.question-image');
        for (var i = 0; i < images.length; i++) {
            if (images[i].complete) {
                setTimeout(scheduleUpdate, 0);
            } else {
                images[i].addEventListener('load', scheduleUpdate);
            }
        }
    }

    // ── Utility functions ──

    function template(str, values) {
        return str.replace(/\{(\w+)\}/g, function (match, key) {
            return values[key] !== undefined ? values[key] : match;
        });
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function parseExplanation(text) {
        if (!text) return '';
        var html = escapeHtml(text);
        html = html.replace(/\+\+(.+?)\+\+/g, '<span class="marker-correct">$1</span>');
        html = html.replace(/--(.+?)--/g, '<span class="marker-incorrect">$1</span>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // Strip {{...}} braces (bold only in correct-answers display)
        html = html.replace(/\{\{(.+?)\}\}/g, '$1');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    function parseCorrectAnswer(text) {
        if (!text) return '';
        var html = escapeHtml(text);
        // Convert {{...}} to bold for correct-answers display
        html = html.replace(/\{\{(.+?)\}\}/g, '<strong>$1</strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    function appendPeriod(text) {
        // Strip markup to find the true last visible character
        var plain = text.replace(/\{\{|\}\}|\*\*|\*/g, '').replace(/\s+$/, '');
        if (!plain) return text;
        var last = plain.charAt(plain.length - 1);
        if ('.!?…,:;׃"\')]\u05F4\u05F3'.indexOf(last) !== -1) return text;
        return text + '.';
    }

    var encouragementEmojis = ['🌤️', '✨', '😊', '🌈'];

    function getFinalFeedback(percentage) {
        var fb = systemTexts.final_feedback;
        if (!fb) return { text: '', isEncouragement: false };
        var pool, key, isEnc = false;
        if (percentage >= 90) {
            pool = fb.excellent; key = 'final_excellent';
        } else if (percentage >= 75) {
            pool = fb.good; key = 'final_good';
        } else if (percentage >= 60) {
            pool = fb.fair; key = 'final_fair';
        } else {
            pool = fb.encouragement; key = 'final_encouragement'; isEnc = true;
        }
        var text = (pool && pool.length > 0) ? getRandomItem(pool, key) : '';
        return { text: text, isEncouragement: isEnc };
    }

    // ── Modal ──

    function showModal(message, onSubmit, onBack) {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        var dialog = document.createElement('div');
        dialog.className = 'modal-dialog';

        var msg = document.createElement('p');
        msg.className = 'modal-message';
        msg.textContent = message;
        dialog.appendChild(msg);

        var buttons = document.createElement('div');
        buttons.className = 'modal-buttons';

        var submitBtn = document.createElement('button');
        submitBtn.className = 'modal-btn-submit';
        submitBtn.textContent = 'לאשר';
        submitBtn.addEventListener('click', function () {
            closeModal();
            onSubmit();
        });

        var backBtn = document.createElement('button');
        backBtn.className = 'modal-btn-back';
        backBtn.textContent = 'לחזור לבחירה';
        backBtn.addEventListener('click', function () {
            closeModal();
            onBack();
        });

        buttons.appendChild(submitBtn);
        buttons.appendChild(backBtn);
        dialog.appendChild(buttons);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Trigger transition
        requestAnimationFrame(function () {
            overlay.classList.add('visible');
        });

        function closeModal() {
            overlay.classList.remove('visible');
            setTimeout(function () {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 200);
        }
    }

    // ── Screens ──

    function showOpening() {
        cleanupScreenListeners();
        var ui = systemTexts.interface;

        app.innerHTML = '';
        var screen = document.createElement('div');
        screen.className = 'screen opening-screen';

        var titleEl = document.createElement('h1');
        titleEl.className = 'series-title';
        titleEl.innerHTML = parseExplanation(quizData.series_title);
        screen.appendChild(titleEl);

        var lineEl = document.createElement('p');
        lineEl.className = 'quiz-line';
        lineEl.innerHTML = parseExplanation(quizLine);
        screen.appendChild(lineEl);

        var startBtn = document.createElement('button');
        startBtn.className = 'start-button';
        startBtn.innerHTML = parseExplanation(ui.start_button);
        startBtn.addEventListener('click', function () {
            showQuestion(0);
        });
        screen.appendChild(startBtn);

        var footer = document.createElement('div');
        footer.className = 'opening-footer';
        footer.textContent = '© כל הזכויות שמורות. נוצר בידי רפי מוזס וחברו קלוד.';
        screen.appendChild(footer);

        app.appendChild(screen);
        setupScreenBehavior();
    }

    function showQuestion(index) {
        currentQuestionIndex = index;
        selectedAnswers = new Set();
        confirmInProgress = false;

        var question = quizData.questions[index];
        var total = quizData.questions.length;
        var ui = systemTexts.interface;

        var correctCount = 0;
        for (var i = 0; i < question.answers.length; i++) {
            if (question.answers[i].correct) correctCount++;
        }
        var isMultiple = correctCount > 1;

        app.innerHTML = '';
        var screen = document.createElement('div');
        screen.className = 'screen question-screen';
        if (isMultiple) screen.classList.add('multiple');

        // Progress
        var progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';

        var progressText = document.createElement('span');
        progressText.className = 'progress-text';
        progressText.innerHTML = parseExplanation(template(ui.question_progress, {
            current: index + 1,
            total: total
        }));
        progressContainer.appendChild(progressText);

        var progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        var progressFill = document.createElement('div');
        progressFill.className = 'progress-fill';
        var targetPct = (index + 1) / total * 100;
        progressFill.style.width = lastProgressPct + '%';
        progressBar.appendChild(progressFill);
        progressContainer.appendChild(progressBar);

        screen.appendChild(progressContainer);

        // Optional question image
        var hasImage = question.image && question.image.length > 0;
        if (hasImage) {
            var imgEl = document.createElement('img');
            imgEl.className = 'question-image';
            imgEl.src = question.image;
            imgEl.alt = '';
            imgEl.addEventListener('load', function () {
                scheduleUpdate();
            });
            screen.appendChild(imgEl);
        }

        // Flip card (feedback card — always present)
        var flipContainer = document.createElement('div');
        flipContainer.className = 'flip-container';

        var flipCard = document.createElement('div');
        flipCard.className = 'flip-card';

        var flipFront = document.createElement('div');
        flipFront.className = 'flip-front';
        flipCard.appendChild(flipFront);

        var flipBack = document.createElement('div');
        flipBack.className = 'flip-back';
        flipCard.appendChild(flipBack);

        flipContainer.appendChild(flipCard);
        // Flip container starts hidden; shown only on feedback
        flipContainer.style.display = 'none';
        screen.appendChild(flipContainer);

        // Question header (badge + text)
        var questionHeader = document.createElement('div');
        questionHeader.className = 'question-header';

        var questionBadge = document.createElement('span');
        questionBadge.className = 'question-badge';
        questionBadge.textContent = index + 1;
        questionHeader.appendChild(questionBadge);

        var questionText = document.createElement('span');
        questionText.className = 'question-text';
        questionText.innerHTML = parseExplanation(question.question);
        questionHeader.appendChild(questionText);

        screen.appendChild(questionHeader);

        // Multi-correct notice
        if (isMultiple) {
            var multiNotice = document.createElement('p');
            multiNotice.className = 'multi-notice';
            multiNotice.textContent = 'יש יותר מתשובה נכונה אחת.';
            screen.appendChild(multiNotice);
        }

        // Answers
        var answersContainer = document.createElement('div');
        answersContainer.className = 'answers-container';

        var confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm-button';
        confirmBtn.innerHTML = parseExplanation(ui.confirm_button);
        confirmBtn.disabled = true;

        // Clear button (multi-correct only)
        var clearBtn = null;
        if (isMultiple) {
            clearBtn = document.createElement('button');
            clearBtn.className = 'clear-button';
            clearBtn.textContent = 'ניקוי הבחירות';
            clearBtn.style.display = 'none';
            clearBtn.addEventListener('click', function () {
                selectedAnswers.clear();
                var options = answersContainer.querySelectorAll('.answer-option');
                for (var i = 0; i < options.length; i++) {
                    options[i].classList.remove('selected');
                }
                confirmBtn.disabled = true;
                clearBtn.style.display = 'none';
            });
        }

        for (var a = 0; a < question.answers.length; a++) {
            (function (ansIndex) {
                var option = document.createElement('div');
                option.className = 'answer-option';

                var circle = document.createElement('span');
                circle.className = 'circle';

                var text = document.createElement('span');
                text.className = 'answer-text';
                text.innerHTML = parseExplanation(question.answers[ansIndex].text);

                option.appendChild(circle);
                option.appendChild(text);

                option.addEventListener('click', function () {
                    selectAnswer(ansIndex, isMultiple, answersContainer, confirmBtn, clearBtn);
                });

                answersContainer.appendChild(option);
            })(a);
        }

        screen.appendChild(answersContainer);

        confirmBtn.addEventListener('click', function () {
            confirmAnswer(question, isMultiple, flipContainer, flipCard, flipBack, screen, answersContainer, confirmBtn);
        });

        screen.appendChild(confirmBtn);
        if (clearBtn) screen.appendChild(clearBtn);

        app.appendChild(screen);

        // Animate progress bar from previous width to new width
        requestAnimationFrame(function () {
            progressFill.style.width = targetPct + '%';
            lastProgressPct = targetPct;
            // Match clear button width to confirm button
            if (clearBtn) {
                clearBtn.style.width = confirmBtn.offsetWidth + 'px';
            }
        });

        setupScreenBehavior();
    }

    function selectAnswer(ansIndex, isMultiple, answersContainer, confirmBtn, clearBtn) {
        if (isMultiple) {
            if (selectedAnswers.has(ansIndex)) {
                selectedAnswers.delete(ansIndex);
            } else {
                selectedAnswers.add(ansIndex);
            }
        } else {
            selectedAnswers.clear();
            selectedAnswers.add(ansIndex);
        }

        var options = answersContainer.querySelectorAll('.answer-option');
        for (var i = 0; i < options.length; i++) {
            if (selectedAnswers.has(i)) {
                options[i].classList.add('selected');
            } else {
                options[i].classList.remove('selected');
            }
        }

        confirmBtn.disabled = selectedAnswers.size === 0;

        // Show/hide clear button for multi-correct
        if (clearBtn) {
            clearBtn.style.display = (isMultiple && selectedAnswers.size > 1) ? '' : 'none';
        }
    }

    function confirmAnswer(question, isMultiple, flipContainer, flipCard, flipBack, screen, answersContainer, confirmBtn) {
        // Guard against double-tap during fade
        if (confirmInProgress) return;

        var ui = systemTexts.interface;

        var correctIndices = new Set();
        for (var i = 0; i < question.answers.length; i++) {
            if (question.answers[i].correct) {
                correctIndices.add(i);
            }
        }

        // Modal: multi-correct question but user selected only 1 answer
        if (correctIndices.size > 1 && selectedAnswers.size === 1) {
            showModal(
                'בשאלה זו יש יותר מתשובה נכונה אחת. לאשר בכל זאת?',
                function () {
                    // Proceed with grading
                    doGrade(question, isMultiple, flipContainer, flipCard, flipBack, screen, answersContainer, confirmBtn, ui, correctIndices);
                },
                function () {
                    // Return to question — do nothing
                }
            );
            return;
        }

        confirmInProgress = true;
        doGrade(question, isMultiple, flipContainer, flipCard, flipBack, screen, answersContainer, confirmBtn, ui, correctIndices);
    }

    function doGrade(question, isMultiple, flipContainer, flipCard, flipBack, screen, answersContainer, confirmBtn, ui, correctIndices) {
        confirmInProgress = true;

        var isCorrect;
        if (isMultiple) {
            if (selectedAnswers.size !== correctIndices.size) {
                isCorrect = false;
            } else {
                isCorrect = true;
                selectedAnswers.forEach(function (idx) {
                    if (!correctIndices.has(idx)) {
                        isCorrect = false;
                    }
                });
            }
        } else {
            var selectedIndex = selectedAnswers.values().next().value;
            isCorrect = correctIndices.has(selectedIndex);
        }

        // Check partial success for multi-correct questions
        var isPartial = false;
        var isAllSelected = false;
        if (correctIndices.size > 1 && !isCorrect) {
            var selectedCorrectCount = 0;
            selectedAnswers.forEach(function (idx) {
                if (correctIndices.has(idx)) selectedCorrectCount++;
            });
            if (selectedAnswers.size === question.answers.length && correctIndices.size < question.answers.length) {
                isAllSelected = true;
            } else if (selectedCorrectCount >= 1 && selectedCorrectCount < correctIndices.size) {
                isPartial = true;
            }
        }

        if (isCorrect) score++;

        // Prepare feedback content before fading
        flipBack.innerHTML = '';
        var resultContent = document.createElement('div');
        resultContent.className = 'result-content ' + (isCorrect ? 'result-correct positive-pulse' : 'result-incorrect');

        if (isCorrect) {
            var positivePool = ui.positive_feedback;
            var positiveText = Array.isArray(positivePool) ? getRandomItem(positivePool, 'positive') : (positivePool || 'יפה מאוד!');
            var symbolSpan = document.createElement('span');
            symbolSpan.className = 'result-symbol';
            symbolSpan.textContent = '✔';
            resultContent.appendChild(symbolSpan);
            var feedbackSpan = document.createElement('span');
            feedbackSpan.className = 'result-feedback';
            feedbackSpan.innerHTML = parseExplanation(positiveText);
            resultContent.appendChild(feedbackSpan);
        } else if (isPartial) {
            var partialPool = ui.partial_feedback;
            var partialText = Array.isArray(partialPool) ? getRandomItem(partialPool, 'partial') : (partialPool || 'כמעט...');
            var feedbackSpanPartial = document.createElement('span');
            feedbackSpanPartial.className = 'result-feedback';
            feedbackSpanPartial.innerHTML = parseExplanation(partialText);
            resultContent.appendChild(feedbackSpanPartial);
        } else if (isAllSelected) {
            var allSelSpan = document.createElement('span');
            allSelSpan.className = 'result-feedback';
            allSelSpan.innerHTML = 'הלכת על כל הקופה... 😊<br>אבל רק ' + correctIndices.size + ' תשובות נכונות.';
            resultContent.appendChild(allSelSpan);
        } else {
            // Fixed wrong-feedback in flip card (same position as positive feedback)
            resultContent.className = 'result-content result-incorrect';
            var wrongSpan = document.createElement('span');
            wrongSpan.className = 'result-feedback wrong-feedback';
            wrongSpan.textContent = 'זו אינה התשובה הנכונה.';
            resultContent.appendChild(wrongSpan);
        }

        flipBack.appendChild(resultContent);

        // Phase 1: fade out the current screen
        screen.classList.add('fade-out');

        setTimeout(function () {
            // Phase 2: swap content while invisible
            answersContainer.remove();
            confirmBtn.remove();
            var clearBtnEl = screen.querySelector('.clear-button');
            if (clearBtnEl) clearBtnEl.remove();
            var multiNoticeEl = screen.querySelector('.multi-notice');
            if (multiNoticeEl) multiNoticeEl.remove();
            var questionHeader = screen.querySelector('.question-header');
            if (questionHeader) questionHeader.remove();

            var questionImage = screen.querySelector('.question-image');
            if (questionImage) questionImage.style.display = 'none';

            flipContainer.style.display = '';
            flipCard.classList.add('flipped');

            // Feedback section below card
            var feedbackSection = document.createElement('div');
            feedbackSection.className = 'feedback-section';

            var correctAnswers = [];
            for (var j = 0; j < question.answers.length; j++) {
                if (question.answers[j].correct) {
                    correctAnswers.push(question.answers[j].text);
                }
            }

            var correctBlock = document.createElement('div');
            correctBlock.className = 'correct-block';

            if (correctAnswers.length === 1) {
                var label = document.createElement('p');
                label.className = 'correct-label-only';
                label.textContent = 'התשובה הנכונה:';
                correctBlock.appendChild(label);
                var value = document.createElement('p');
                value.className = 'correct-answer';
                value.innerHTML = parseCorrectAnswer(appendPeriod(correctAnswers[0]));
                correctBlock.appendChild(value);
            } else if (correctAnswers.length > 1) {
                var labelOnly = document.createElement('p');
                labelOnly.className = 'correct-label-only';
                labelOnly.textContent = 'התשובות הנכונות:';
                correctBlock.appendChild(labelOnly);

                for (var k = 0; k < correctAnswers.length; k++) {
                    var ansEl = document.createElement('p');
                    ansEl.className = 'correct-answer';
                    ansEl.innerHTML = parseCorrectAnswer(appendPeriod(correctAnswers[k]));
                    correctBlock.appendChild(ansEl);
                }
            }

            feedbackSection.appendChild(correctBlock);

            if (question.explanation) {
                var explanationEl = document.createElement('div');
                explanationEl.className = 'explanation';
                explanationEl.innerHTML = parseExplanation(question.explanation);
                feedbackSection.appendChild(explanationEl);
            }

            var nextBtn = document.createElement('button');
            nextBtn.className = 'next-button';
            var isLast = currentQuestionIndex === quizData.questions.length - 1;
            nextBtn.innerHTML = parseExplanation(isLast ? 'איך יצא לי?' : ui.next_button);
            nextBtn.addEventListener('click', function () {
                if (isLast) {
                    showFinal();
                } else {
                    showQuestion(currentQuestionIndex + 1);
                }
            });
            feedbackSection.appendChild(nextBtn);

            screen.appendChild(feedbackSection);

            // Phase 3: fade in the new content
            screen.classList.remove('fade-out');

            // Re-evaluate sticky + scroll hint after fade-in completes
            // (avoids layout thrash during animation that stalls the compositor)
            setTimeout(setupScreenBehavior, 340);
        }, 260);
    }

    function showFinal() {
        cleanupScreenListeners();
        var ui = systemTexts.interface;
        var total = quizData.questions.length;
        var percentage = Math.round((score / total) * 100);

        app.innerHTML = '';
        var screen = document.createElement('div');
        screen.className = 'screen final-screen';

        if (ui.final_title) {
            var titleEl = document.createElement('h2');
            titleEl.className = 'final-title';
            titleEl.innerHTML = parseExplanation(ui.final_title);
            screen.appendChild(titleEl);
        }

        var scoreEl = document.createElement('p');
        scoreEl.className = 'final-score';
        scoreEl.innerHTML = parseExplanation(template(ui.final_score, {
            correct: score,
            total: total
        }));
        screen.appendChild(scoreEl);

        var pctEl = document.createElement('p');
        pctEl.className = 'final-percentage';
        pctEl.textContent = percentage + '%';
        screen.appendChild(pctEl);

        var evalResult = getFinalFeedback(percentage);
        if (evalResult.text) {
            var evalText = evalResult.text;
            if (evalResult.isEncouragement) {
                evalText += ' ' + encouragementEmojis[Math.floor(Math.random() * encouragementEmojis.length)];
            }
            var evalEl = document.createElement('p');
            evalEl.className = 'final-evaluation';
            evalEl.innerHTML = parseExplanation(evalText);
            screen.appendChild(evalEl);
        }

        app.appendChild(screen);
        setupScreenBehavior();
    }

    showOpening();
})();
