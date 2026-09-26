// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract OffGridDAO {
    
    struct Proposal {
        uint256 id;
        string title;
        string description;
        string category;
        uint256 fundsRequested;
        uint256 votes;
        bool active;
    }

    // Mapping of proposal ID to Proposal
    mapping(uint256 => Proposal) public proposals;
    
    // Voting is scoped per proposal: one vote per wallet PER PROPOSAL. The
    // same wallet may vote on proposal 1, 2, 3, ... but never twice on the
    // same proposal. Keyed [proposalId][voter] so the state lives with the
    // proposal instead of with the address.
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // Token balances per wallet address
    mapping(address => uint256) public tokenBalances;

    // Track if a voter has received their initial free allocation
    mapping(address => bool) public isInitialized;

    // To iterate easily, we keep a counter of total proposals
    uint256 public proposalCount;

    // Default token allocation for new voters
    uint256 public constant DEFAULT_TOKENS = 1000;

    // Fee for submitting a proposal.
    //
    // Creating a proposal is NOT a voting action: it must not read or write
    // any voting state. A member who already voted stays eligible to submit
    // new proposals, and a member who only creates proposals keeps their
    // vote available for every proposal (including their own).
    uint256 public constant PROPOSAL_CREATION_FEE = 100;

    // Cost of casting a vote. Charged once per proposal, because a wallet may
    // vote only once on any given proposal.
    uint256 public constant VOTE_COST = 100;

    // Events to let the backend know something happened instantly
    event ProposalCreated(uint256 indexed id, string title, uint256 fundsRequested);
    event VoteCast(address indexed voter, uint256 indexed proposalId, uint256 newVoteCount);
    event TokensAllocated(address indexed voter, uint256 amount);

    // Create a new proposal (costs PROPOSAL_CREATION_FEE tokens)
    function createProposal(string memory _title, string memory _description, string memory _category, uint256 _fundsRequested) public {
        // Deliberately no voting-state check here: `hasVoted` only gates
        // `vote`, per proposal. The creator starts at 0 votes.
        require(tokenBalances[msg.sender] >= PROPOSAL_CREATION_FEE, "Insufficient tokens to create a proposal (costs 100)");

        // Deduct tokens
        tokenBalances[msg.sender] -= PROPOSAL_CREATION_FEE;

        proposalCount++;
        proposals[proposalCount] = Proposal({
            id: proposalCount,
            title: _title,
            description: _description,
            category: _category,
            fundsRequested: _fundsRequested,
            votes: 0, // Creating is not voting; the creator has not voted yet
            active: true
        });

        emit ProposalCreated(proposalCount, _title, _fundsRequested);
    }

    // Allocate tokens to a voter (called by server on first card scan)
    function allocateTokens(address _voter, uint256 _amount) public {
        require(!isInitialized[_voter], "Voter already received initial tokens");
        tokenBalances[_voter] += _amount;
        isInitialized[_voter] = true;
        emit TokensAllocated(_voter, _amount);
    }

    // Cast a vote for a single proposal
    //
    // The vote is recorded against the proposal, not the wallet: one vote per
    // wallet per proposal, and the same wallet may still vote on every other
    // proposal. This is the ONLY place voting state gates an action.
    function vote(uint256 _proposalId) public {
        require(_proposalId > 0 && _proposalId <= proposalCount, "Proposal does not exist");
        require(proposals[_proposalId].active, "Proposal is no longer active");
        require(!hasVoted[_proposalId][msg.sender], "You have already voted on this proposal.");
        require(tokenBalances[msg.sender] >= VOTE_COST, "Insufficient tokens to vote (costs 100)");

        // Deduct tokens
        tokenBalances[msg.sender] -= VOTE_COST;

        proposals[_proposalId].votes++;
        hasVoted[_proposalId][msg.sender] = true;

        emit VoteCast(msg.sender, _proposalId, proposals[_proposalId].votes);
    }

    // Get token balance for a voter
    function getTokenBalance(address _voter) public view returns (uint256) {
        return tokenBalances[_voter];
    }

    // Helper to get all details of a proposal
    function getProposal(uint256 _proposalId) public view returns (Proposal memory) {
        return proposals[_proposalId];
    }
}
