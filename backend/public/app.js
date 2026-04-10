/* ═══════════════════════════════════════════════
   OFF-GRID DAO — Client-Side Application Logic
   State Machine: BROWSE → AWAIT_TAP → CONFIRMED → BROWSE
   NFC card tap is the FINAL confirmation step.
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── STATE ──
    let state = 'BROWSE'; // BROWSE | AWAIT_TAP | CONFIRMED
    let proposals = [];
    let transactions = [];
    let resetTimer = null;

    // Pending vote — set when user selects a proposal, cleared after NFC confirms
    let pendingVote = null; // { proposalId, proposalTitle, fundsRequested }

    // ── DOM REFS ──
    const stateBrowse = document.getElementById('stateBrowse');
    const stateAwaitTap = document.getElementById('stateAwaitTap');
    const stateConfirmed = document.getElementById('stateConfirmed');

    const proposalsGrid = document.getElementById('proposalsGrid');

    const selectionVoteBadge = document.getElementById('selectionVoteBadge');
    const selectionTitle = document.getElementById('selectionTitle');
    const selectionFunds = document.getElementById('selectionFunds');

    const voterAvatar = document.getElementById('voterAvatar');
    const voterName = document.getElementById('voterName');
    const voterWard = document.getElementById('voterWard');
    const voterWallet = document.getElementById('voterWallet');
    const voterTokenBalance = document.getElementById('voterTokenBalance');

    const confirmDetail = document.getElementById('confirmDetail');
    const confirmTxHash = document.getElementById('confirmTxHash');
    const resetCountdown = document.getElementById('resetCountdown');

    const activeProposalCount = document.getElementById('activeProposalCount');
    const totalVoteCount = document.getElementById('totalVoteCount');
    const blockCount = document.getElementById('blockCount');
    const treasuryAmount = document.getElementById('treasuryAmount');

    const feedScroll = document.getElementById('feedScroll');

    // ── SOCKET.IO CONNECTION ──
    const socket = io();

    socket.on('connect', () => {
        console.log('🔌 Connected to DAO backend');
        updateConnectionStatus(true);
    });

    socket.on('disconnect', () => {
        console.log('❌ Disconnected from DAO backend');
        updateConnectionStatus(false);
    });

    // Initial state load
    socket.on('init', (data) => {
        console.log('📦 Initial state received:', data);
        proposals = data.proposals || [];
        transactions = data.transactions || [];
        updateBrowseStats();
        renderTransactionFeed();
        renderProposals();
        if (data.treasury) {
            treasuryAmount.textContent = data.treasury.totalFunds.toLocaleString();
        }
    });

    // ── PROPOSALS UPDATED (new proposal added) ──
    socket.on('proposals-updated', (data) => {
        console.log('📝 Proposals updated from blockchain:', data);
        proposals = data;
        renderProposals();
        updateBrowseStats();
    });

    // ── NFC CARD SCANNED ──
    // This is now the CONFIRMATION step — it fires the pending vote
    socket.on('card-scanned', (data) => {
        console.log('📡 Card scanned:', data);

        // If we're not awaiting a tap, just show a quick flash and ignore
        if (state !== 'AWAIT_TAP' || !pendingVote) {
            console.log('⚠️ Card scanned but no pending vote. Ignoring.');
            createFlashEffect('scan-flash');
            return;
        }

        const voter = data.voter;

        // Flash effect
        createFlashEffect('scan-flash');

        // Add identity verification to feed
        addTransactionToFeed(data.transaction);

        // Now submit the pending vote
        submitVote(voter.cardId, pendingVote.proposalId);
    });

    // ── VOTE RECORDED (from server after successful vote) ──
    socket.on('vote-recorded', (data) => {
        console.log('🗳️ Vote recorded:', data);

        createFlashEffect('vote-flash');

        // Update proposals data
        const idx = proposals.findIndex(p => p.id === data.proposal.id);
        if (idx !== -1) proposals[idx] = data.proposal;

        renderProposals();
        updateBrowseStats();

        // Add to transaction feed
        addTransactionToFeed(data.transaction);

        // Show voter info on confirmation
        voterAvatar.textContent = data.voter.avatar;
        voterName.textContent = `${data.voter.name}`;
        voterWard.textContent = data.voter.ward;
        voterWallet.textContent = data.voter.wallet;
        if (data.voter.tokenBalance !== undefined) {
            voterTokenBalance.textContent = data.voter.tokenBalance.toLocaleString() + ' Tokens';
        }

        // Show confirmation
        confirmDetail.textContent = `Successfully supported "${data.proposal.title}"`;
        confirmTxHash.textContent = data.transaction.hash;

        // Clear pending vote
        pendingVote = null;

        switchState('CONFIRMED');

        // Countdown to reset back to browse
        let count = 15;
        resetCountdown.textContent = count;
        clearResetTimer();
        resetTimer = setInterval(() => {
            count--;
            resetCountdown.textContent = count;
            if (count <= 0) {
                clearInterval(resetTimer);
                switchState('BROWSE');
            }
        }, 1000);
    });

    // ── STATE MACHINE ──
    function switchState(newState) {
        state = newState;

        stateBrowse.classList.remove('active');
        stateAwaitTap.classList.remove('active');
        stateConfirmed.classList.remove('active');

        switch (newState) {
            case 'BROWSE':
                stateBrowse.classList.add('active');
                pendingVote = null;
                renderProposals();
                updateBrowseStats();
                break;
            case 'AWAIT_TAP':
                stateAwaitTap.classList.add('active');
                break;
            case 'CONFIRMED':
                stateConfirmed.classList.add('active');
                break;
        }

        console.log(`🔄 State → ${newState}`);
    }

    // ── RENDER PROPOSALS ──
    function renderProposals() {
        proposalsGrid.innerHTML = '';

        const totalVotesGlobally = proposals.reduce((sum, p) => sum + (p.votes || 0), 0);

        proposals.forEach((proposal) => {
            const percent = totalVotesGlobally > 0 ? Math.round((proposal.votes / totalVotesGlobally) * 100) : 0;

            const card = document.createElement('div');
            card.className = 'proposal-card';
            card.id = `proposal-${proposal.id}`;

            card.innerHTML = `
                <div class="proposal-header">
                    <h4 class="proposal-title">${proposal.title}</h4>
                    <span class="proposal-category category-${proposal.category}">${proposal.category}</span>
                </div>
                <p class="proposal-desc">${proposal.description}</p>
                <div class="proposal-funds">
                    Tokens Required: <span class="proposal-funds-amount">${proposal.fundsRequested.toLocaleString()} DAO Tokens</span>
                </div>
                <div class="vote-bar-container">
                    <div class="vote-bar-labels">
                        <span class="vote-yes-label" style="color: var(--text-primary)">🗳️ Votes: ${proposal.votes}</span>
                        <span class="vote-no-label" style="color: rgba(255,255,255,0.5);">${percent}% of total</span>
                    </div>
                    <div class="vote-bar">
                        <div class="vote-bar-fill" style="width: ${percent}%; background: var(--accent-blue);"></div>
                    </div>
                </div>
                <div class="vote-buttons" style="display: flex; justify-content: center;">
                    <button class="vote-btn vote-btn-yes" style="flex: 1;" id="selectVote-${proposal.id}" onclick="selectVote(${proposal.id})">🗳️ Support Project</button>
                </div>
            `;

            proposalsGrid.appendChild(card);
        });
    }

    // ── SELECT VOTE ──
    window.selectVote = function (proposalId) {
        const proposal = proposals.find(p => p.id === proposalId);
        if (!proposal) return;

        pendingVote = {
            proposalId: proposal.id,
            proposalTitle: proposal.title,
            fundsRequested: proposal.fundsRequested,
        };

        selectionVoteBadge.textContent = "SELECTED";
        selectionVoteBadge.className = 'selection-badge selection-badge-yes';
        selectionTitle.textContent = proposal.title;
        selectionFunds.textContent = `${proposal.fundsRequested.toLocaleString()} DAO Tokens`;

        switchState('AWAIT_TAP');

        clearResetTimer();
        resetTimer = setTimeout(() => {
            if (state === 'AWAIT_TAP') {
                pendingVote = null;
                switchState('BROWSE');
            }
        }, 60000);
    };

    // ── GO BACK TO BROWSE ──
    window.goBackToBrowse = function () {
        pendingVote = null;
        clearResetTimer();
        switchState('BROWSE');
    };

    // ── SUBMIT VOTE ──
    async function submitVote(cardId, proposalId) {
        try {
            const response = await fetch('/vote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cardId, proposalId }),
            });

            const result = await response.json();

            if (!response.ok) {
                console.error('Vote failed:', result.error);
                const tapTitle = document.querySelector('.tap-title');
                if (tapTitle) {
                    tapTitle.textContent = '⚠️ ' + (result.error || 'Vote failed');
                    tapTitle.style.background = 'var(--accent-red)';
                    tapTitle.style.webkitBackgroundClip = 'text';
                    setTimeout(() => {
                        tapTitle.textContent = 'Tap Your Card to Confirm';
                        tapTitle.style.background = 'linear-gradient(135deg, var(--text-primary), var(--accent-blue))';
                        tapTitle.style.webkitBackgroundClip = 'text';
                    }, 3000);
                }
            }
        } catch (err) {
            console.error('Network error:', err);
            const tapTitle = document.querySelector('.tap-title');
            if (tapTitle) {
                tapTitle.textContent = '⚠️ Network error — try again';
                tapTitle.style.background = 'var(--accent-red)';
                tapTitle.style.webkitBackgroundClip = 'text';
                setTimeout(() => {
                    tapTitle.textContent = 'Tap Your Card to Confirm';
                    tapTitle.style.background = 'linear-gradient(135deg, var(--text-primary), var(--accent-blue))';
                    tapTitle.style.webkitBackgroundClip = 'text';
                }, 3000);
            }
        }
    }

    // ── ADD PROPOSAL MODAL ──
    window.openAddProposalModal = function () {
        document.getElementById('addProposalModal').style.display = 'flex';
    };

    window.closeAddProposalModal = function () {
        document.getElementById('addProposalModal').style.display = 'none';
        document.getElementById('addProposalForm').reset();
        document.getElementById('formStatus').textContent = '';
    };

    window.submitNewProposal = async function (e) {
        e.preventDefault();
        const title = document.getElementById('propTitle').value.trim();
        const description = document.getElementById('propDesc').value.trim();
        const category = document.getElementById('propCategory').value;
        const fundsRequested = parseInt(document.getElementById('propFunds').value, 10);

        const statusEl = document.getElementById('formStatus');
        const submitBtn = document.getElementById('btnSubmitProposal');

        statusEl.textContent = '⏳ Deploying to blockchain...';
        statusEl.style.color = 'var(--accent-blue)';
        submitBtn.disabled = true;

        try {
            const response = await fetch('/proposals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, description, category, fundsRequested }),
            });

            const result = await response.json();

            if (response.ok) {
                statusEl.textContent = '✅ Proposal deployed to blockchain!';
                statusEl.style.color = 'var(--accent-green)';
                setTimeout(() => {
                    closeAddProposalModal();
                }, 1500);
            } else {
                statusEl.textContent = '❌ ' + (result.error || 'Failed');
                statusEl.style.color = 'var(--accent-red)';
            }
        } catch (err) {
            statusEl.textContent = '❌ Network error';
            statusEl.style.color = 'var(--accent-red)';
        }
        submitBtn.disabled = false;
    };

    // ── TRANSACTION FEED ──
    function addTransactionToFeed(tx) {
        transactions.push(tx);

        const item = document.createElement('div');
        item.className = 'feed-item';

        const time = new Date(tx.timestamp).toLocaleTimeString();

        item.innerHTML = `
            <span class="feed-block">#${tx.id}</span>
            <span class="feed-type feed-type-${tx.type}">${tx.type.replace('_', ' ')}</span>
            <span class="feed-hash">${tx.hash.slice(0, 16)}…</span>
            <span class="feed-time">${time}</span>
        `;

        feedScroll.prepend(item);

        while (feedScroll.children.length > 30) {
            feedScroll.removeChild(feedScroll.lastChild);
        }

        updateBrowseStats();
    }

    function renderTransactionFeed() {
        transactions.forEach(tx => {
            const item = document.createElement('div');
            item.className = 'feed-item';
            const time = new Date(tx.timestamp).toLocaleTimeString();
            item.innerHTML = `
                <span class="feed-block">#${tx.id}</span>
                <span class="feed-type feed-type-${tx.type}">${tx.type.replace('_', ' ')}</span>
                <span class="feed-hash">${tx.hash.slice(0, 16)}…</span>
                <span class="feed-time">${time}</span>
            `;
            feedScroll.prepend(item);
        });
    }

    // ── UI HELPERS ──
    function updateBrowseStats() {
        const activeCount = proposals.filter(p => p.status === 'active').length;
        const totalVotes = proposals.reduce((sum, p) => sum + (p.votes || 0), 0);

        activeProposalCount.textContent = activeCount;
        totalVoteCount.textContent = totalVotes;
        blockCount.textContent = transactions.length;
    }

    function updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connectionStatus');
        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');

        if (connected) {
            dot.style.background = 'var(--accent-green)';
            dot.style.boxShadow = '0 0 8px var(--accent-green)';
            text.textContent = 'Connected';
            text.style.color = 'var(--accent-green)';
        } else {
            dot.style.background = 'var(--accent-red)';
            dot.style.boxShadow = '0 0 8px var(--accent-red)';
            text.textContent = 'Disconnected';
            text.style.color = 'var(--accent-red)';
        }
    }

    function createFlashEffect(className) {
        const flash = document.createElement('div');
        flash.className = className;
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 800);
    }

    function clearResetTimer() {
        if (resetTimer) {
            clearTimeout(resetTimer);
            clearInterval(resetTimer);
            resetTimer = null;
        }
    }

})();
