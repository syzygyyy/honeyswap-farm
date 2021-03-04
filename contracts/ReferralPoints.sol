// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

contract ReferralPoints is ERC20, Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal _trustedBurners;

    event BurnerAdded(address indexed newBurner);
    event BurnerRemoved(address indexed prevBurner);

    constructor() ERC20("Honey Referral Points", "HRP") Ownable() { }

    modifier onlyMetaOwner {
        require(msg.sender == Ownable(owner()).owner(), "HRP: Not meta owner");
        _;
    }

    function mint(address recipient, uint256 amount) external onlyOwner {
        _mint(recipient, amount);
    }

    function directBurn(address account, uint256 amount) external {
        require(
            _trustedBurners.contains(msg.sender),
            "HRP: Not a trusted burner"
        );
        _burn(account, amount);
    }

    function addBurner(address newBurner) external onlyMetaOwner {
        require(_trustedBurners.add(newBurner), "HRP: Already burner");
        emit BurnerAdded(newBurner);
    }

    function removeBurner(address burner) external onlyMetaOwner {
        require(_trustedBurners.remove(burner), "HRP: Not burner");
        emit BurnerRemoved(burner);
    }

    /* --- Intropsective methods --- */

    function getTrustedBurnerCount() public view returns(uint256) {
        return _trustedBurners.length();
    }

    function getTrustedBurner(uint256 index) public view returns(address) {
        return _trustedBurners.at(index);
    }
}
