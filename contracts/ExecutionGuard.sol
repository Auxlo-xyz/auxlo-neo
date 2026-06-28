// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ExecutionGuard
 * @dev Implements user-scoped trading policies to prevent AI hallucinations 
 * from executing dangerous on-chain transactions.
 */
contract ExecutionGuard {
    struct UserPolicy {
        uint256 maxTradeValueUSD; // In cents or smallest unit (e.g., * 10^6)
        uint256 maxSlippageBps;   // Basis points (100 = 1%)
        bool tradingEnabled;
        mapping(address => bool) allowedProtocols;
    }

    mapping(address => UserPolicy) public userPolicies;
    address public owner;

    event PolicyUpdated(address indexed user, uint256 maxTrade, uint256 slippage, bool enabled);
    event ProtocolAdded(address indexed user, address indexed protocol);
    event ProtocolRemoved(address indexed user, address indexed protocol);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }

    /**
     * @dev Set basic risk parameters for a user.
     * Called by the AuxloNeo agent via the Muscle.
     */
    function setPolicy(
        address user, 
        uint256 maxTrade, 
        uint256 slippage, 
        bool enabled
    ) external onlyOwner {
        UserPolicy storage policy = userPolicies[user];
        policy.maxTradeValueUSD = maxTrade;
        policy.maxSlippageBps = slippage;
        policy.tradingEnabled = enabled;
        
        emit PolicyUpdated(user, maxTrade, slippage, enabled);
    }

    function addProtocol(address user, address protocol) external onlyOwner {
        userPolicies[user].allowedProtocols[protocol] = true;
        emit ProtocolAdded(user, protocol);
    }

    function removeProtocol(address user, address protocol) external onlyOwner {
        userPolicies[user].allowedProtocols[protocol] = false;
        emit ProtocolRemoved(user, protocol);
    }

    /**
     * @dev The "Hard Check". Returns true if the transaction is within policy.
     * This is called immediately before a trade is executed.
     */
    function verifyTransaction(
        address user,
        uint256 valueUSD,
        uint256 slippageBps,
        address targetProtocol
    ) external view returns (bool) {
        UserPolicy storage policy = userPolicies[user];
        
        if (!policy.tradingEnabled) return false;
        if (valueUSD > policy.maxTradeValueUSD) return false;
        if (slippageBps > policy.maxSlippageBps) return false;
        if (!policy.allowedProtocols[targetProtocol]) return false;
        
        return true;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}
