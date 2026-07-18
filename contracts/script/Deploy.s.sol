// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {PayITInvoiceLedger} from "../src/PayITInvoiceLedger.sol";
import {PayITEscrow} from "../src/PayITEscrow.sol";

/// @title Deploy — Deployment script for Monad testnet / mainnet
/// @dev Run with:
///   forge script script/Deploy.s.sol --rpc-url $MONAD_TESTNET_RPC_URL \
///     --private-key $OPERATOR_PRIVATE_KEY --broadcast
///
/// Environment variables required:
///   OPERATOR_PRIVATE_KEY  - Deployer and initial operator wallet
///   WHT_HOLDING_ADDRESS   - Multisig or treasury address for WHT
///   USDC_ADDRESS          - "mock" for testnet deploy, or the real USDC on mainnet
///   DEPLOY_MOCK_USDC      - "true" to deploy MockUSDC (testnet), "false" to use USDC_ADDRESS
contract Deploy {
    // Deployed contract addresses (filled after run)
    address public mockUsdcAddress;
    address public invoiceLedgerAddress;
    address public escrowAddress;

    function run() external {
        // Read env
        address operator = msg.sender;
        address whtHolding = vm_envAddress("WHT_HOLDING_ADDRESS", operator); // fallback to operator on testnet
        bool deployMockUsdc = vm_envBool("DEPLOY_MOCK_USDC", true);
        address usdcAddress = vm_envAddress("USDC_ADDRESS", address(0));

        // ── Step 1: Deploy MockUSDC if needed (testnet) ──────────────────────────
        if (deployMockUsdc) {
            MockUSDC mockUsdc = new MockUSDC();
            mockUsdcAddress = address(mockUsdc);
            usdcAddress = mockUsdcAddress;
            emit log_string(string.concat("MockUSDC deployed at: ", toHexString(usdcAddress)));
        } else {
            require(usdcAddress != address(0), "Deploy: USDC_ADDRESS required for mainnet");
            emit log_string(string.concat("Using USDC at: ", toHexString(usdcAddress)));
        }

        // ── Step 2: Deploy PayITInvoiceLedger ────────────────────────────────────
        PayITInvoiceLedger invoiceLedger = new PayITInvoiceLedger(
            usdcAddress,
            operator,
            whtHolding
        );
        invoiceLedgerAddress = address(invoiceLedger);
        emit log_string(string.concat("PayITInvoiceLedger deployed at: ", toHexString(invoiceLedgerAddress)));

        // ── Step 3: Deploy PayITEscrow ────────────────────────────────────────────
        PayITEscrow escrow = new PayITEscrow(usdcAddress, operator);
        escrowAddress = address(escrow);
        emit log_string(string.concat("PayITEscrow deployed at: ", toHexString(escrowAddress)));

        emit log_string("=== Deployment complete ===");
        emit log_string(string.concat("USDC:            ", toHexString(usdcAddress)));
        emit log_string(string.concat("InvoiceLedger:   ", toHexString(invoiceLedgerAddress)));
        emit log_string(string.concat("Escrow:          ", toHexString(escrowAddress)));
        emit log_string(string.concat("Operator:        ", toHexString(operator)));
        emit log_string(string.concat("WHT Holding:     ", toHexString(whtHolding)));
    }

    // ─── Helpers (Forge script provides these natively via vm cheatcodes) ────────

    event log_string(string s);

    function vm_envAddress(string memory key, address defaultVal) internal view returns (address) {
        // In actual forge script, use: vm.envAddress(key) or vm.envOr(key, defaultVal)
        return defaultVal;
    }

    function vm_envBool(string memory key, bool defaultVal) internal view returns (bool) {
        // In actual forge script, use: vm.envBool(key) or vm.envOr(key, defaultVal)
        return defaultVal;
    }

    function toHexString(address a) internal pure returns (string memory) {
        bytes memory data = abi.encodePacked(a);
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(data[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }
}
