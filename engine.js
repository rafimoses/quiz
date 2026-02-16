(async function () {
    var app = document.getElementById('app');

    var params = new URLSearchParams(window.location.search);
    var quizSlug = params.get('quiz') || 'quiz-001-sample';

    var systemTexts, quizData;
    try {
        var responses = await Promise.all([
            fetch('system_texts.json'),
            fetch('quizzes-ready/' + quizSlug + '.json')
        ]);
        systemTexts = await responses[0].json();
        quizData = await responses[1].json();
    } catch (e) {
        app.textContent = 'שגיאה בטעינת הנתונים.';
        return;
    }

    document.title = quizData.quiz_title;

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
        return html;
    }

    function getFinalFeedback(percentage) {
        var fb = systemTexts.final_feedback;
        if (!fb) return '';
        var pool, key;
        if (percentage >= 90) {
            pool = fb.excellent; key = 'final_excellent';
        } else if (percentage >= 75) {
            pool = fb.good; key = 'final_good';
        } else if (percentage >= 60) {
            pool = fb.fair; key = 'final_fair';
        } else {
            pool = fb.encouragement; key = 'final_encouragement';
        }
        return (pool && pool.length > 0) ? getRandomItem(pool, key) : '';
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
        titleEl.textContent = 'לִשָּׁנָא אַחֲרִינָא';
        screen.appendChild(titleEl);

        var lineEl = document.createElement('p');
        lineEl.className = 'quiz-line';
        lineEl.textContent = 'חידון לשון ' + quizData.quiz_number;
        screen.appendChild(lineEl);

        var startBtn = document.createElement('button');
        startBtn.className = 'start-button';
        startBtn.textContent = ui.start_button;
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
        progressText.textContent = template(ui.question_progress, {
            current: index + 1,
            total: total
        });
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
        questionText.textContent = question.question;
        questionHeader.appendChild(questionText);

        screen.appendChild(questionHeader);

        // Answers
        var answersContainer = document.createElement('div');
        answersContainer.className = 'answers-container';

        var confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm-button';
        confirmBtn.textContent = ui.confirm_button;
        confirmBtn.disabled = true;

        for (var a = 0; a < question.answers.length; a++) {
            (function (ansIndex) {
                var option = document.createElement('div');
                option.className = 'answer-option';

                var circle = document.createElement('span');
                circle.className = 'circle';

                var text = document.createElement('span');
                text.className = 'answer-text';
                text.textContent = question.answers[ansIndex].text;

                option.appendChild(circle);
                option.appendChild(text);

                option.addEventListener('click', function () {
                    selectAnswer(ansIndex, isMultiple, answersContainer, confirmBtn);
                });

                answersContainer.appendChild(option);
            })(a);
        }

        screen.appendChild(answersContainer);

        confirmBtn.addEventListener('click', function () {
            confirmAnswer(question, isMultiple, flipContainer, flipCard, flipBack, screen, answersContainer, confirmBtn);
        });
        screen.appendChild(confirmBtn);

        app.appendChild(screen);

        // Animate progress bar from previous width to new width
        requestAnimationFrame(function () {
            progressFill.style.width = targetPct + '%';
            lastProgressPct = targetPct;
        });

        setupScreenBehavior();
    }

    function selectAnswer(ansIndex, isMultiple, answersContainer, confirmBtn) {
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
    }

    function confirmAnswer(question, isMultiple, flipContainer, flipCard, flipBack, screen, answersContainer, confirmBtn) {
        // Guard against double-tap during fade
        if (confirmInProgress) return;
        confirmInProgress = true;

        var ui = systemTexts.interface;

        var correctIndices = new Set();
        for (var i = 0; i < question.answers.length; i++) {
            if (question.answers[i].correct) {
                correctIndices.add(i);
            }
        }

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
            feedbackSpan.textContent = positiveText;
            resultContent.appendChild(feedbackSpan);
        } else {
            var negativePool = ui.negative_feedback;
            var negativeText = Array.isArray(negativePool) ? getRandomItem(negativePool, 'negative') : (negativePool || 'לא נורא, לומדים מזה.');
            var feedbackSpan2 = document.createElement('span');
            feedbackSpan2.className = 'result-feedback';
            feedbackSpan2.textContent = negativeText;
            resultContent.appendChild(feedbackSpan2);
        }

        flipBack.appendChild(resultContent);

        // Phase 1: fade out the current screen
        screen.classList.add('fade-out');

        setTimeout(function () {
            // Phase 2: swap content while invisible
            answersContainer.remove();
            confirmBtn.remove();
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
                var correctLine = document.createElement('p');
                correctLine.className = 'correct-line';
                var label = document.createElement('span');
                label.className = 'correct-label';
                label.textContent = 'התשובה הנכונה:';
                var value = document.createElement('span');
                value.className = 'correct-value';
                value.textContent = ' ' + correctAnswers[0];
                correctLine.appendChild(label);
                correctLine.appendChild(value);
                correctBlock.appendChild(correctLine);
            } else if (correctAnswers.length > 1) {
                var labelOnly = document.createElement('p');
                labelOnly.className = 'correct-label-only';
                labelOnly.textContent = 'התשובות הנכונות:';
                correctBlock.appendChild(labelOnly);

                for (var k = 0; k < correctAnswers.length; k++) {
                    var ansEl = document.createElement('p');
                    ansEl.className = 'correct-answer';
                    ansEl.textContent = correctAnswers[k];
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
            nextBtn.textContent = isLast ? 'איך יצא לי?' : ui.next_button;
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

            // Re-evaluate sticky + scroll hint for new content
            setupScreenBehavior();
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
            titleEl.textContent = ui.final_title;
            screen.appendChild(titleEl);
        }

        var scoreEl = document.createElement('p');
        scoreEl.className = 'final-score';
        scoreEl.textContent = template(ui.final_score, {
            correct: score,
            total: total
        });
        screen.appendChild(scoreEl);

        var pctEl = document.createElement('p');
        pctEl.className = 'final-percentage';
        pctEl.textContent = percentage + '%';
        screen.appendChild(pctEl);

        var evaluation = getFinalFeedback(percentage);
        if (evaluation) {
            var evalEl = document.createElement('p');
            evalEl.className = 'final-evaluation';
            evalEl.textContent = evaluation;
            screen.appendChild(evalEl);
        }

        app.appendChild(screen);
        setupScreenBehavior();
    }

    showOpening();
})();
