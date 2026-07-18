// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title MockUSDC
/// @notice A simple ERC-20 token that mimics USDC for Monad testnet development.
/// @dev Has a public mint function — NOT for production use.
contract MockUSDC {
    // ─── ERC-20 State ───────────────────────────────────────────────────────────
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ─── Events ─────────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ─── Core ERC-20 ────────────────────────────────────────────────────────────

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "MockUSDC: insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    // ─── Testnet Mint ────────────────────────────────────────────────────────────

    /// @notice Mint tokens to any address. Testnet only — no access control.
    /// @param to Recipient address
    /// @param amount Amount in USDC base units (1 USDC = 1_000_000)
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    // ─── Internal ────────────────────────────────────────────────────────────────

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "MockUSDC: transfer from zero address");
        require(to != address(0), "MockUSDC: transfer to zero address");
        require(balanceOf[from] >= amount, "MockUSDC: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
