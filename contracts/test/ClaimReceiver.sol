// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.24;

interface ReleaseTarget { function claim(bytes32 releaseId, address beneficiary) external; }

/// @dev Adversarial receiver used only by the local EVM tests.
contract ClaimReceiver {
    address public immutable target;
    uint256 public mode;
    bytes32 public releaseId;
    bool public reentered;
    constructor(address target_) { target = target_; }
    function configure(uint256 mode_, bytes32 releaseId_) external { mode = mode_; releaseId = releaseId_; }
    function invoke(bytes calldata data) external {
        (bool success, bytes memory result) = target.call(data);
        if (!success) assembly { revert(add(result, 32), mload(result)) }
    }
    receive() external payable {
        if (mode == 1) revert("receiver refused payment");
        if (mode == 2) (reentered,) = target.call(abi.encodeCall(ReleaseTarget.claim, (releaseId, address(this))));
    }
}
