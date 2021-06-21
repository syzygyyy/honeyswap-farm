// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IStreamedAirdropper.sol";

contract Claimer is Ownable {
    using SafeERC20 for IERC20;

    IStreamedAirdropper public immutable airdropper;
    bytes32 public immutable merkleRoot;
    IERC20 public immutable token;
    uint256 public immutable claimEnd;
    mapping(bytes32 => bool) public hasAlreadyClaimed;

    event Claimed(
        address indexed claimer,
        address indexed recipient,
        uint256 amount
    );

    constructor(
        address _airdropper,
        bytes32 _merkleRoot,
        IERC20 _token,
        uint256 _claimEnd
    )
        Ownable()
    {
        _token.safeApprove(_airdropper, type(uint256).max);
        airdropper = IStreamedAirdropper(_airdropper);
        merkleRoot = _merkleRoot;
        token = _token;
        claimEnd = _claimEnd;
    }

    function emptyTo(address _recipient) external onlyOwner {
        require(block.timestamp >= claimEnd, "Claimer: Claim period ongoing");
        token.safeTransfer(_recipient, token.balanceOf(address(this)));
    }

    function claimTo(
        address _recipient,
        bytes32[] memory _proof,
        uint256 _amount
    )
        external
    {
        require(block.timestamp < claimEnd, "Claimer: Claim has expired");
        bytes32 claimLeaf = createClaimLeaf(msg.sender, _amount);
        require(!hasAlreadyClaimed[claimLeaf], "Claimer: Has already claimed");
        require(MerkleProof.verify(_proof, merkleRoot, claimLeaf), "Claimer: Invalid proof");
        hasAlreadyClaimed[claimLeaf] = true;
        airdropper.addVesting(_recipient, _amount);
        emit Claimed(msg.sender, _recipient, _amount);
    }

    function createClaimLeaf(address _claimer, uint256 _amount)
        public pure returns (bytes32)
    {
        return keccak256(abi.encode(_claimer, _amount));
    }
}
