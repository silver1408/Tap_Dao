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
    
    // Strict Global Requirement: One vote per address globally!
    mapping(address => bool) public hasVotedGlobally;

    // Token balances per wallet address
    mapping(address => uint256) public tokenBalances;

    // Track if a voter has received their initial free allocation
    mapping(address => bool) public isInitialized;

    // To iterate easily, we keep a counter of total proposals
    uint256 public proposalCount;

    // Default token allocation for new voters
    uint256 public constant DEFAULT_TOKENS = 1000;

    // Events to let the backend know something happened instantly
    event ProposalCreated(uint256 indexed id, string title, uint256 fundsRequested);
    event VoteCast(address indexed voter, uint256 indexed proposalId, uint256 newVoteCount);
    event TokensAllocated(address indexed voter, uint256 amount);

    // Create a new proposal (anyone can create)
    function createProposal(string memory _title, string memory _description, string memory _category, uint256 _fundsRequested) public {
        proposalCount++;
        proposals[proposalCount] = Proposal({
            id: proposalCount,
            title: _title,
            description: _description,
            category: _category,
            fundsRequested: _fundsRequested,
            votes: 0,
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
    function vote(uint256 _proposalId) public {
        require(_proposalId > 0 && _proposalId <= proposalCount, "Proposal does not exist");
        require(proposals[_proposalId].active, "Proposal is no longer active");
        require(!hasVotedGlobally[msg.sender], "You have already voted! Only one vote allowed overall.");
        require(tokenBalances[msg.sender] >= 100, "Insufficient tokens to vote (costs 100)");

        // Deduct tokens
        tokenBalances[msg.sender] -= 100;

        proposals[_proposalId].votes++;
        hasVotedGlobally[msg.sender] = true;

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
