// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleWallet {

    mapping(address => uint256) public balances;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Deposit(address indexed by, uint256 amount);
    event Withdrawal(address indexed by, uint256 amount);

    // ── DEPOSIT ──────────────────────────────────────────
    function deposit() external payable {
        // external is cheaper than public (saves gas)
        require(msg.value > 0, "Send some ETH");
        unchecked {
            // unchecked saves gas — overflow impossible here
            balances[msg.sender] += msg.value;
        }
        emit Deposit(msg.sender, msg.value);
    }

    // ── TRANSFER ─────────────────────────────────────────
    function transfer(address to, uint256 amount) external {
        require(to != address(0),               "Invalid address");
        require(to != msg.sender,               "Cannot send to yourself");
        require(amount > 0,                     "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        unchecked {
            balances[msg.sender] -= amount;
            balances[to]         += amount;
        }

        emit Transfer(msg.sender, to, amount);
    }

    // ── WITHDRAW ─────────────────────────────────────────
    function withdraw(uint256 amount) external {
        require(amount > 0,                     "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        unchecked {
            balances[msg.sender] -= amount;
        }

        (bool success, ) = msg.sender.call{
            value: amount,
            gas: 2300          // limit gas forwarded to prevent reentrancy
        }("");
        require(success, "Transfer failed");

        emit Withdrawal(msg.sender, amount);
    }

    // ── VIEW (free, no gas) ───────────────────────────────
    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    // ── CHECK CONTRACT'S TOTAL ETH ────────────────────────
    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}